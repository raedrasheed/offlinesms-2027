// Callable: escalateSms — Phase 8 hardened.
//
// Sends a message via the OfflineSMS SMS Gateway to recipients resolved
// from Phase 7 receipt data. Honours daily-batch caps, audience-size
// caps, per-message cooldown, and persists quota usage. Every state
// transition is audited with counts-only metadata — never the SMS body,
// never the message body, never full phone numbers.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { sendBatch } from './gateway';
import {
  canonicalAudience, classifyRecipients, filterByAudience, findAlreadySentUids,
  loadExternalEligibles, isExternalRecipientId,
  AudienceInput,
  COOLDOWN_MS, COST_PER_SMS, MAX_BATCHES_PER_DAY, MAX_RECIPIENTS_PER_BATCH,
  todayKey,
} from './recipients';
import { resolveProvider, resolveDefaultRelayBusiness } from './provider';
import { relayModeEngaged, isHybrid, summarizeOutcomes } from './relayLogic';
import { partitionRecipientsByCoverage } from './countryRouting';
import { dispatchBatchToRelay } from './relayDispatcher';
import { maybeFinalizeRelayBatch } from './relaySettlement';
import { writeAuditLog } from '../lib/auditLog';

const SMS_BODY_MAX = 320;

export const escalateSms = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as {
    messageId?:      unknown;
    conversationId?: unknown;
    audience?:       unknown;
    smsBody?:        unknown;
  };
  if (typeof data.messageId      !== 'string' || !data.messageId)      throw new HttpsError('invalid-argument', 'messageId-required');
  if (typeof data.conversationId !== 'string' || !data.conversationId) throw new HttpsError('invalid-argument', 'conversationId-required');
  if (typeof data.audience       !== 'string')                          throw new HttpsError('invalid-argument', 'audience-required');
  if (typeof data.smsBody        !== 'string')                          throw new HttpsError('invalid-argument', 'smsBody-required');

  const validAudiences = ['everyone', 'unread_only', 'undelivered_only', 'unread', 'undelivered'];
  if (!validAudiences.includes(data.audience)) {
    throw new HttpsError('invalid-argument', 'audience-invalid');
  }
  const audience = canonicalAudience(data.audience as AudienceInput);

  const smsBody = data.smsBody.trim();
  if (smsBody.length === 0)          throw new HttpsError('invalid-argument', 'smsBody-empty');
  if (smsBody.length > SMS_BODY_MAX) throw new HttpsError('invalid-argument', 'smsBody-too-long');

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(data.conversationId);
  const msgRef = convoRef.collection('messages').doc(data.messageId);

  const [convoSnap, msgSnap] = await Promise.all([convoRef.get(), msgRef.get()]);
  if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
  if (!msgSnap.exists)   throw new HttpsError('not-found', 'message-not-found');

  const convo = convoSnap.data() as { participantUids?: string[]; memberIds?: string[]; type?: string };
  const participants = convo.participantUids ?? convo.memberIds ?? [];
  if (!participants.includes(uid)) {
    throw new HttpsError('permission-denied', 'not-a-participant');
  }

  const msg = msgSnap.data() as { senderUid?: string; senderId?: string; deletedForEveryone?: boolean };
  const senderUid = msg.senderUid ?? msg.senderId;
  if (senderUid !== uid) {
    // Group owners/admins may escalate other members' messages.
    if (convo.type !== 'group') {
      throw new HttpsError('permission-denied', 'not-message-sender');
    }
    const memberSnap = await convoRef.collection('members').doc(uid).get();
    const role = (memberSnap.data()?.role ?? '') as string;
    if (role !== 'owner' && role !== 'admin') {
      throw new HttpsError('permission-denied', 'admins-only');
    }
  }
  if (msg.deletedForEveryone) {
    throw new HttpsError('failed-precondition', 'message-deleted');
  }

  // Daily-cap check.
  const day = todayKey();
  const quotaRef = db.collection('smsQuotaUsage').doc(uid).collection('days').doc(day);
  const quotaSnap = await quotaRef.get();
  const batchesToday = (quotaSnap.data()?.batchCount as number) ?? 0;
  if (batchesToday >= MAX_BATCHES_PER_DAY) {
    await writeAuditLog({
      action: 'sms.escalation.failed', actor: { uid },
      target: { type: 'message', id: data.messageId }, result: 'failure',
      metadata: { reason: 'rate-limited', conversationId: data.conversationId, audience },
    });
    throw new HttpsError('resource-exhausted', 'daily-cap-reached');
  }

  // Cooldown: same (messageId, senderUid) within COOLDOWN_MS.
  const recentSnap = await db.collection('smsBatches')
    .where('senderId', '==', uid)
    .where('messageId', '==', data.messageId)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  if (!recentSnap.empty) {
    const last = recentSnap.docs[0].data() as { createdAt?: Timestamp; status?: string };
    const lastMs = last.createdAt?.toMillis?.() ?? 0;
    if (lastMs > 0 && Date.now() - lastMs < COOLDOWN_MS && last.status !== 'failed') {
      await writeAuditLog({
        action: 'sms.escalation.failed', actor: { uid },
        target: { type: 'message', id: data.messageId }, result: 'failure',
        metadata: { reason: 'cooldown', conversationId: data.conversationId, audience },
      });
      throw new HttpsError('failed-precondition', 'cooldown-active');
    }
  }

  // Resolve audience → candidates → eligible / excluded.
  const receiptsSnap = await msgRef.collection('receipts').get();
  const receiptsByUid = new Map<string, { status?: string }>();
  for (const r of receiptsSnap.docs) {
    receiptsByUid.set(r.id, { status: (r.data() as { status?: string }).status });
  }
  const { candidates } = filterByAudience(audience, participants, senderUid ?? uid, receiptsByUid);
  const alreadySent = await findAlreadySentUids(db, uid, data.messageId);
  const { eligible, excluded } = await classifyRecipients(db, candidates, alreadySent);

  // Phase 25 — include the group's external phone contacts in the recipient
  // set. They get an `ext:<digits>` synthetic id and carry their own phone, so
  // the rest of the pipeline (cost, relay jobs, recipient docs, settlement)
  // treats them like any other recipient. Audience filters apply only to
  // in-app receipts, so external contacts are always targeted (they have no
  // in-app delivery state).
  if (convo.type === 'group') {
    const existingPhones = new Set(eligible.map(e => e.phone));
    const externalEligible = await loadExternalEligibles(db, data.conversationId, participants, existingPhones);
    for (const e of externalEligible) eligible.push(e);
  }

  if (eligible.length === 0) throw new HttpsError('failed-precondition', 'no-eligible-recipients');

  // ── Country-based relay routing (relay path only) ──
  // Resolve the relay org + provider mode up-front. When relay is engaged, drop
  // recipients whose detected country has no live relay BEFORE reserving points,
  // so billing matches exactly what gets sent. HTTP mode is unaffected.
  const orgId = (request.auth?.token?.organizationId as string | undefined)
    ?? (await resolveDefaultRelayBusiness());
  const providerMode = await resolveProvider(orgId);
  const relayMode = relayModeEngaged(providerMode) && !!orgId;

  let uncoveredCountry: { uid: string; reason: string; countryCode: string | null }[] = [];
  let countrySummary: ReturnType<typeof summarizeOutcomes> | null = null;
  if (relayMode) {
    const { covered, uncovered } = await partitionRecipientsByCoverage(
      orgId as string, eligible.map(e => ({ id: e.uid, phoneE164: e.phone })),
    );
    countrySummary = summarizeOutcomes([
      ...covered.map(c => ({ countryCode: c.countryCode, queued: true })),
      ...uncovered.map(u => ({ countryCode: u.countryCode, queued: false, reason: u.reason })),
    ]);
    const uncoveredIds = new Set(uncovered.map(u => u.id));
    for (let i = eligible.length - 1; i >= 0; i--) {
      if (uncoveredIds.has(eligible[i].uid)) eligible.splice(i, 1);
    }
    uncoveredCountry = uncovered.map(u => ({ uid: u.id, reason: u.reason, countryCode: u.countryCode }));
  }

  if (eligible.length === 0) {
    // Nothing to send. If everyone was dropped for lack of relay coverage, say so.
    throw new HttpsError('failed-precondition',
      uncoveredCountry.length > 0 ? 'no_relay_for_country' : 'no-eligible-recipients');
  }
  if (eligible.length > MAX_RECIPIENTS_PER_BATCH) {
    throw new HttpsError('failed-precondition', 'audience-too-large');
  }

  // Reserve points.
  const cost = eligible.length * COST_PER_SMS;
  const walletRef = db.collection('wallets').doc(uid);
  await db.runTransaction(async tx => {
    const w = await tx.get(walletRef);
    const balance = w.exists ? ((w.get('balance') as number) ?? 0) : 0;
    if (balance < cost) throw new HttpsError('failed-precondition', 'not-enough-points');
    tx.set(walletRef, {
      balance:  balance - cost,
      reserved: FieldValue.increment(cost),
    }, { merge: true });
  });

  // Create batch doc.
  const batchRef = db.collection('smsBatches').doc();
  const now = FieldValue.serverTimestamp();
  await batchRef.set({
    messageId:         data.messageId,
    conversationId:    data.conversationId,
    senderId:          uid,
    audience:          data.audience,
    audienceCanonical: audience,
    smsBody,
    recipientCount:    eligible.length,
    eligibleCount:     eligible.length,
    excludedCount:     excluded.length + uncoveredCountry.length,
    // Aggregate counters surfaced by the admin Gateway list.
    totalCount:        eligible.length,
    queuedCount:       eligible.length,
    sentCount:         0,
    deliveredCount:    0,
    failedCount:       0,
    estimatedCost:     cost,
    pointsCost:        cost,
    pointsReserved:    cost,
    pointsDeducted:    null,
    pointsRefunded:    null,
    status:            'sending',
    gatewayBatchId:    null,
    offlineSmsBatchId: null,
    retryOfBatchId:    null,
    createdAt:         now,
    updatedAt:         now,
  });

  // Phase 10: emit a canonical 'reservation' transaction so the wallet
  // UI shows the hold event. The matching reservation_release is
  // emitted by onSmsBatchAccepted on settlement.
  await db.collection('transactions').add({
    userId:            uid,
    type:              'reservation',
    direction:         'debit',
    amount:            cost,
    status:             'completed',
    relatedSmsBatchId:  batchRef.id,
    createdAt:          FieldValue.serverTimestamp(),
    completedAt:        FieldValue.serverTimestamp(),
  });

  await writeAuditLog({
    action: 'sms.escalation.created',
    actor:  { uid },
    target: { type: 'message', id: data.messageId },
    result: 'success',
    metadata: {
      batchId:        batchRef.id,
      conversationId: data.conversationId,
      audience,
      eligibleCount:  eligible.length,
      excludedCount:  excluded.length,
      pointsCost:     cost,
    },
  });

  // Write excluded-recipient rows so the UI can render them.
  if (excluded.length > 0) {
    const skipBatch = db.batch();
    for (const e of excluded) {
      skipBatch.set(batchRef.collection('recipients').doc(e.uid), {
        userId:           e.uid,
        maskedPhone:      null,
        appReceiptStatus: e.appReceiptStatus,
        smsStatus:        'skipped',
        skipReason:       e.skipReason,
        reason:           e.skipReason,
        updatedAt:        FieldValue.serverTimestamp(),
      });
    }
    await skipBatch.commit();
  }

  // Write country-uncovered recipients as skipped (no_relay_for_country) so the
  // UI and summary show exactly who wasn't sent and why.
  if (uncoveredCountry.length > 0) {
    const noRelayBatch = db.batch();
    for (const u of uncoveredCountry) {
      noRelayBatch.set(batchRef.collection('recipients').doc(u.uid), {
        userId:     u.uid,
        maskedPhone: null,
        smsStatus:  'skipped',
        skipReason: u.reason,
        reason:     u.reason,
        recipientCountryCode: u.countryCode,
        updatedAt:  FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await noRelayBatch.commit();
  }

  // ── Phase 5: relay path (feature-flagged + organization-scoped) ──
  // Relay engages only when the sender's org is configured for relay/hybrid
  // (resolved as orgId/providerMode above). Country coverage was already applied
  // to `eligible`; the dispatcher re-checks defensively before creating any job.
  if (relayMode) {
    const hybrid = isHybrid(providerMode);

    // Mark eligible recipients queued (relay pending).
    const recipBatch = db.batch();
    for (const e of eligible) {
      const ext = isExternalRecipientId(e.uid);
      recipBatch.set(batchRef.collection('recipients').doc(e.uid), {
        userId: e.uid, maskedPhone: e.maskedPhone, appReceiptStatus: e.appReceiptStatus,
        smsStatus: 'queued', skipReason: null, reason: null, updatedAt: FieldValue.serverTimestamp(),
        // External recipients have no users/{uid} doc, so the relay dispatcher
        // reads the number straight off the recipient row.
        ...(ext ? { isExternal: true, phoneE164: e.phone } : {}),
      });
    }
    await recipBatch.commit();

    // Route to devices. Relay-only queues unrouted recipients; hybrid returns
    // them for HTTP fallback (no relay job exists for them → no double-send).
    const dispatch = await dispatchBatchToRelay(batchRef.id, orgId, { allowUnassignedQueue: !hybrid });

    let fallbackCount = 0;
    if (hybrid && dispatch.unrouted.length > 0) {
      const fb = eligible.filter(e => dispatch.unrouted.includes(e.uid));
      fallbackCount = fb.length;
      const fbWrites = db.batch();
      try {
        const r = await sendBatch(batchRef.id, smsBody, fb.map(e => ({ uid: e.uid, phone: e.phone, maskedPhone: e.maskedPhone })));
        for (const e of fb) {
          const ok = r.acceptedRecipientIds.includes(e.uid);
          fbWrites.set(batchRef.collection('recipients').doc(e.uid),
            { smsStatus: ok ? 'queued' : 'failed', reason: ok ? null : 'gateway-error', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
      } catch {
        for (const e of fb) fbWrites.set(batchRef.collection('recipients').doc(e.uid),
          { smsStatus: 'failed', reason: 'gateway-error', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      await fbWrites.commit();
      await writeAuditLog({ action: 'relay.http_fallback', actor: { uid }, target: { type: 'message', id: data.messageId }, result: 'success', metadata: { batchId: batchRef.id, businessId: orgId, count: fallbackCount } });
    }

    // Relay batches stay 'sending'; settlement is deferred to completion
    // reconciliation (maybeFinalizeRelayBatch → sending→completed → existing
    // onSmsBatchAccepted), so later relay failures are refunded by the existing
    // pipeline. The reservation is held until then.
    await batchRef.update({ provider: providerMode, updatedAt: FieldValue.serverTimestamp() });
    await quotaRef.set({
      uid, date: day, batchCount: FieldValue.increment(1),
      recipientCount: FieldValue.increment(eligible.length), pointsSpent: FieldValue.increment(cost),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // If nothing was routed to a relay device (e.g. hybrid where every recipient
    // fell back to HTTP), there are no relay jobs to await → finalize now so the
    // existing settlement runs immediately, just like the HTTP path.
    let finalStatus = 'sending';
    if (dispatch.routed === 0) {
      const ok = await maybeFinalizeRelayBatch(batchRef.id);
      if (ok) finalStatus = 'completed';
    }

    await writeAuditLog({
      action: 'sms.escalation.accepted', actor: { uid }, target: { type: 'message', id: data.messageId }, result: 'success',
      metadata: { batchId: batchRef.id, conversationId: data.conversationId, audience, provider: providerMode, routed: dispatch.routed, fallback: fallbackCount, pointsCost: cost },
    });

    return {
      batchId: batchRef.id, offlineSmsBatchId: null,
      sent: eligible.length, failed: 0,
      skipped: excluded.length + uncoveredCountry.length,
      noRelayForCountry: uncoveredCountry.length,
      countrySummary,
      pointsCost: cost, status: finalStatus, provider: providerMode,
    };
  }

  // Dispatch via OfflineSMS Gateway.
  let result: Awaited<ReturnType<typeof sendBatch>>;
  try {
    result = await sendBatch(
      batchRef.id, smsBody,
      eligible.map(e => ({ uid: e.uid, phone: e.phone, maskedPhone: e.maskedPhone })),
    );
  } catch {
    await batchRef.update({ status: 'failed', updatedAt: FieldValue.serverTimestamp() });
    await writeAuditLog({
      action: 'sms.escalation.failed', actor: { uid },
      target: { type: 'message', id: data.messageId }, result: 'failure',
      metadata: { batchId: batchRef.id, reason: 'gateway-error' },
    });
    throw new HttpsError('internal', 'gateway-error');
  }

  // Persist per-recipient sends + finalise batch + bump quota.
  const sendsBatch = db.batch();
  for (const e of eligible) {
    const ok = result.acceptedRecipientIds.includes(e.uid);
    const rejection = result.rejectedRecipientIds.find(x => x.uid === e.uid);
    sendsBatch.set(batchRef.collection('recipients').doc(e.uid), {
      userId:           e.uid,
      maskedPhone:      e.maskedPhone,
      appReceiptStatus: e.appReceiptStatus,
      ...(isExternalRecipientId(e.uid) ? { isExternal: true, phoneE164: e.phone } : {}),
      smsStatus:        ok ? 'queued' : 'failed',
      skipReason:       null,
      reason:           ok ? null : (rejection?.reason ?? 'gateway-error'),
      updatedAt:        FieldValue.serverTimestamp(),
    });
  }
  const failedCount = result.rejectedRecipientIds.length;
  const finalStatus: 'accepted' | 'partial' | 'failed' =
    failedCount === 0 ? 'accepted'
      : failedCount === eligible.length ? 'failed'
      : 'partial';
  sendsBatch.update(batchRef, {
    status:            finalStatus,
    gatewayBatchId:    result.gatewayBatchId,
    offlineSmsBatchId: result.gatewayBatchId,
    queuedCount:       eligible.length - failedCount,
    failedCount:       failedCount,
    updatedAt:         FieldValue.serverTimestamp(),
  });
  sendsBatch.set(quotaRef, {
    uid,
    date:           day,
    batchCount:     FieldValue.increment(1),
    recipientCount: FieldValue.increment(eligible.length),
    pointsSpent:    FieldValue.increment(cost),
    updatedAt:      FieldValue.serverTimestamp(),
  }, { merge: true });
  await sendsBatch.commit();

  await writeAuditLog({
    action: finalStatus === 'failed' ? 'sms.escalation.failed' : 'sms.escalation.accepted',
    actor:  { uid },
    target: { type: 'message', id: data.messageId },
    result: finalStatus === 'failed' ? 'failure' : 'success',
    metadata: {
      batchId:        batchRef.id,
      conversationId: data.conversationId,
      audience,
      sent:           result.acceptedRecipientIds.length,
      failed:         failedCount,
      pointsCost:     cost,
    },
  });

  return {
    batchId:           batchRef.id,
    offlineSmsBatchId: result.gatewayBatchId,
    sent:              result.acceptedRecipientIds.length,
    failed:            failedCount,
    skipped:           excluded.length,
    pointsCost:        cost,
    status:            finalStatus,
  };
});
