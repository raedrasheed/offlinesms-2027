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
  canonicalAudience, classifyRecipients, filterByAudience,
  AudienceInput,
  COOLDOWN_MS, COST_PER_SMS, MAX_BATCHES_PER_DAY, MAX_RECIPIENTS_PER_BATCH,
  todayKey,
} from './recipients';
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
  const { eligible, excluded } = await classifyRecipients(db, candidates);

  if (eligible.length === 0) throw new HttpsError('failed-precondition', 'no-eligible-recipients');
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
    excludedCount:     excluded.length,
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
