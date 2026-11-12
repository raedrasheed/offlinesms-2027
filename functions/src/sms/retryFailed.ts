// Callable: retryFailedSmsRecipients
//
// Creates a new batch (linked via retryOfBatchId) that re-dispatches the
// failed recipients of an existing batch via the OfflineSMS Gateway.
// Sender or admin only. Bypasses the conversation cooldown — the cooldown
// is meant to prevent accidental duplicate escalations, not to block a
// targeted recovery attempt.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { sendBatch } from './gateway';
import { MAX_BATCHES_PER_DAY, maskPhone, todayKey, isExternalRecipientId } from './recipients';
import { writeAuditLog } from '../lib/auditLog';
import { findLinkedPhoneNumbers, readUserPhone } from '../lib/userPrivate';
import { normalizePhoneAndCountry } from '../lib/phoneCountry';
import { smsBatchUnitCost } from './messageFormat';
import { reserveSmsBatch } from './reserveBatch';
import { resolveDefaultRelayBusiness, resolveProvider, type SmsProviderMode } from './provider';
import { loadOrganizationRelayAssignment, partitionRecipientsByCoverage } from './countryRouting';
import { relayModeEngaged, isHybrid } from './relayLogic';
import { dispatchBatchToRelay } from './relayDispatcher';
import { maybeFinalizeRelayBatch } from './relaySettlement';

export const retryFailedSmsRecipients = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { batchId?: unknown };
  if (typeof data.batchId !== 'string' || !data.batchId) {
    throw new HttpsError('invalid-argument', 'batchId-required');
  }

  const db = getFirestore();
  const sourceRef = db.collection('smsBatches').doc(data.batchId);
  const sourceSnap = await sourceRef.get();
  if (!sourceSnap.exists) throw new HttpsError('not-found', 'batch-not-found');

  const source = sourceSnap.data() as {
    senderId?: string;
    organizationId?: string;
    orgBatchId?: string;
    provider?: SmsProviderMode;
    conversationId?: string;
    messageId?: string;
    smsBody?: string;
    smsPricingVersion?: number;
    pointsPerRecipient?: number;
    smsSegments?: number;
    smsEncoding?: string;
    smsUnits?: number;
    audience?: string;
    audienceCanonical?: string;
  };
  const token = (request.auth?.token ?? {}) as Record<string, unknown>;
  const senderIsAdmin =
    token.admin === true ||
    token.role === 'super_admin' ||
    (token.role === 'organization_admin' && typeof source.organizationId === 'string'
      && token.organizationId === source.organizationId);
  if (source.senderId !== uid && !senderIsAdmin) {
    throw new HttpsError('permission-denied', 'not-batch-owner');
  }
  const businessOrganizationId = source.orgBatchId ? source.organizationId : undefined;
  const billingUid = businessOrganizationId ? `orgsender_${businessOrganizationId}` : uid;

  // Daily-cap check still applies to retries.
  const day = todayKey();
  const quotaRef = db.collection('smsQuotaUsage').doc(uid).collection('days').doc(day);
  const quotaSnap = await quotaRef.get();
  if (((quotaSnap.data()?.batchCount as number) ?? 0) >= MAX_BATCHES_PER_DAY) {
    throw new HttpsError('resource-exhausted', 'daily-cap-reached');
  }

  // Collect failed recipients from the source batch.
  const failedSnap = await sourceRef.collection('recipients').where('smsStatus', '==', 'failed').get();
  if (failedSnap.empty) {
    throw new HttpsError('failed-precondition', 'nothing-to-retry');
  }

  // Phase 11: cross-batch dedupe — skip recipients who already
  // received a non-failed SMS for the same originating message
  // (e.g. another retry batch landed in between).
  const sourceMessageId = source.messageId ?? '';
  const alreadySent = new Set<string>();
  if (sourceMessageId) {
    const prior = await db.collection('smsBatches')
      .where('senderId',  '==', billingUid)
      .where('messageId', '==', sourceMessageId)
      .limit(50)
      .get();
    for (const b of prior.docs) {
      if (b.id === data.batchId) continue;       // skip the source itself
      const rcs = await b.ref.collection('recipients').get();
      for (const r of rcs.docs) {
        const st = r.get('smsStatus') as string | undefined;
        if (st === 'queued' || st === 'sent' || st === 'delivered') {
          alreadySent.add(r.id);
        }
      }
    }
  }

  type Failed = { uid: string; phone: string; maskedPhone: string; appReceiptStatus: string | null };
  let failed: Failed[] = [];
  const skippedByDedupe: string[] = [];
  for (const r of failedSnap.docs) {
    if (alreadySent.has(r.id)) {
      skippedByDedupe.push(r.id);
      continue;
    }
    // F1 Phase C: read the phone from users/{uid}/userPrivate/profile (private only).
    const external = isExternalRecipientId(r.id) && r.get('isExternal') === true;
    const phone = external
      ? r.get('phoneE164') as string | undefined
      : (await readUserPhone(db, r.id)) ?? undefined;
    if (!phone) continue;
    if (businessOrganizationId && external) {
      const normalized = normalizePhoneAndCountry(phone);
      if (!normalized.isValid || normalized.e164 !== phone) continue;
    }
    failed.push({
      uid: r.id,
      phone,
      maskedPhone: maskPhone(phone),
      appReceiptStatus: (r.data() as { appReceiptStatus?: string }).appReceiptStatus ?? null,
    });
  }
  if (businessOrganizationId) {
    // A number may have registered after the first attempt. Do not bypass its
    // account preferences by retrying the original phone-only destination.
    const linkedPhones = await findLinkedPhoneNumbers(
      db, failed.filter(r => isExternalRecipientId(r.uid)).map(r => r.phone),
    );
    failed = failed.filter(r => !isExternalRecipientId(r.uid) || !linkedPhones.has(r.phone));
  }
  if (failed.length === 0) throw new HttpsError('failed-precondition', 'no-eligible-failed-recipients');

  // Preserve the original provider/business and recheck country coverage
  // before charging. A relay retry must create relay jobs, not a mock HTTP send.
  const orgId = source.organizationId ?? await resolveDefaultRelayBusiness();
  const organizationRelayDeviceId = businessOrganizationId
    ? await loadOrganizationRelayAssignment(businessOrganizationId)
    : undefined;
  const requiresRelay = organizationRelayDeviceId
    || (businessOrganizationId && failed.some(r => isExternalRecipientId(r.uid)));
  const providerMode = requiresRelay ? 'relay' : source.provider ?? await resolveProvider(orgId);
  const coverage = orgId
    ? await partitionRecipientsByCoverage(orgId, failed.map(r => ({ id: r.uid, phoneE164: r.phone })), { organizationRelayDeviceId })
    : { covered: [] };
  const coveredIds = new Set(coverage.covered.map(r => r.id));
  for (let i = failed.length - 1; i >= 0; i--) if (!coveredIds.has(failed[i].uid)) failed.splice(i, 1);
  if (!failed.length) throw new HttpsError('failed-precondition', 'no_relay_for_country');

  // Reserve points for the retry batch.
  const cost = failed.length * smsBatchUnitCost(source);
  // Create the retry batch.
  const newRef = db.collection('smsBatches').doc();
  const now = FieldValue.serverTimestamp();
  await reserveSmsBatch(db, billingUid, newRef, cost, {
    messageId:         source.messageId ?? null,
    conversationId:    source.conversationId ?? null,
    senderId:          billingUid,
    organizationId:    orgId,
    ...(businessOrganizationId ? { orgBatchId: source.orgBatchId } : {}),
    provider:          providerMode,
    audience:          source.audience ?? source.audienceCanonical ?? 'everyone',
    audienceCanonical: source.audienceCanonical ?? 'everyone',
    // Reuse the exact originally quoted body/price. Never append metadata again.
    smsBody:           source.smsBody ?? '',
    ...(source.smsPricingVersion === 1 ? {
      smsPricingVersion: 1,
      pointsPerRecipient: smsBatchUnitCost(source),
      ...(source.smsSegments != null ? { smsSegments: source.smsSegments } : {}),
      ...(source.smsEncoding != null ? { smsEncoding: source.smsEncoding } : {}),
      ...(source.smsUnits != null ? { smsUnits: source.smsUnits } : {}),
    } : {}),
    recipientCount:    failed.length,
    eligibleCount:     failed.length,
    excludedCount:     0,
    estimatedCost:     cost,
    pointsCost:        cost,
    pointsReserved:    cost,
    pointsDeducted:    null,
    pointsRefunded:    null,
    status:            'sending',
    gatewayBatchId:    null,
    offlineSmsBatchId: null,
    retryOfBatchId:    data.batchId,
    attemptNumber:     ((source as { attemptNumber?: number }).attemptNumber ?? 1) + 1,
    createdAt:         now,
    updatedAt:         now,
  });

  await writeAuditLog({
    action: 'sms.retry.created',
    actor:  { uid },
    target: { type: 'sms-batch', id: newRef.id },
    result: 'success',
    metadata: {
      batchId:        newRef.id,
      retryOf:        data.batchId,
      count:          failed.length,
      pointsCost:     cost,
      skippedByDedupe: skippedByDedupe.length,
    },
  });

  if (relayModeEngaged(providerMode) && orgId) {
    const writes = db.batch();
    for (const r of failed) writes.set(newRef.collection('recipients').doc(r.uid), {
      userId: r.uid, maskedPhone: r.maskedPhone, appReceiptStatus: r.appReceiptStatus,
      smsStatus: 'queued', reason: null, skipReason: null, updatedAt: FieldValue.serverTimestamp(),
      ...(isExternalRecipientId(r.uid) ? { isExternal: true, phoneE164: r.phone } : {}),
    });
    await writes.commit();
    const hybrid = isHybrid(providerMode);
    const dispatch = await dispatchBatchToRelay(newRef.id, orgId, { allowUnassignedQueue: !hybrid, organizationRelayDeviceId });
    if (hybrid && dispatch.unrouted.length) {
      const fallback = failed.filter(r => dispatch.unrouted.includes(r.uid));
      const fallbackWrites = db.batch();
      let accepted = new Set<string>();
      try { accepted = new Set((await sendBatch(newRef.id, source.smsBody ?? '', fallback)).acceptedRecipientIds); } catch { /* mark fallback failed */ }
      for (const r of fallback) fallbackWrites.update(newRef.collection('recipients').doc(r.uid), {
        smsStatus: accepted.has(r.uid) ? 'queued' : 'failed',
        reason: accepted.has(r.uid) ? null : 'gateway-error', updatedAt: FieldValue.serverTimestamp(),
      });
      await fallbackWrites.commit();
    }
    await quotaRef.set({ uid, date: day, batchCount: FieldValue.increment(1),
      recipientCount: FieldValue.increment(failed.length), pointsSpent: FieldValue.increment(cost),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (dispatch.routed === 0) await maybeFinalizeRelayBatch(newRef.id);
    const [roster, fresh] = await Promise.all([newRef.collection('recipients').get(), newRef.get()]);
    return { batchId: newRef.id, retryOf: data.batchId,
      sent: roster.docs.filter(r => ['queued', 'sent', 'delivered'].includes(r.get('smsStatus'))).length,
      failed: roster.docs.filter(r => r.get('smsStatus') === 'failed').length,
      skipped: roster.docs.filter(r => r.get('smsStatus') === 'skipped').length,
      pointsCost: cost, status: fresh.get('status') as string };
  }

  let result: Awaited<ReturnType<typeof sendBatch>>;
  try {
    result = await sendBatch(newRef.id, source.smsBody ?? '', failed);
  } catch {
    await newRef.update({ status: 'failed', updatedAt: FieldValue.serverTimestamp() });
    await writeAuditLog({
      action: 'sms.retry.failed',
      actor:  { uid },
      target: { type: 'sms-batch', id: newRef.id },
      result: 'failure',
      metadata: { batchId: newRef.id, retryOf: data.batchId, reason: 'gateway-error' },
    });
    throw new HttpsError('internal', 'gateway-error');
  }

  const batch = db.batch();
  for (const r of failed) {
    const ok = result.acceptedRecipientIds.includes(r.uid);
    const rejection = result.rejectedRecipientIds.find(x => x.uid === r.uid);
    batch.set(newRef.collection('recipients').doc(r.uid), {
      userId:           r.uid,
      maskedPhone:      r.maskedPhone,
      appReceiptStatus: r.appReceiptStatus,
      ...(isExternalRecipientId(r.uid) ? { isExternal: true, phoneE164: r.phone } : {}),
      smsStatus:        ok ? 'queued' : 'failed',
      reason:           ok ? null : (rejection?.reason ?? 'gateway-error'),
      skipReason:       null,
      updatedAt:        FieldValue.serverTimestamp(),
    });
  }
  const failedCount = result.rejectedRecipientIds.length;
  const finalStatus: 'accepted' | 'partial' | 'failed' =
    failedCount === 0 ? 'accepted'
      : failedCount === failed.length ? 'failed'
      : 'partial';
  batch.update(newRef, {
    status:            finalStatus,
    gatewayBatchId:    result.gatewayBatchId,
    offlineSmsBatchId: result.gatewayBatchId,
    updatedAt:         FieldValue.serverTimestamp(),
  });
  batch.set(quotaRef, {
    uid,
    date:            day,
    batchCount:      FieldValue.increment(1),
    recipientCount:  FieldValue.increment(failed.length),
    pointsSpent:     FieldValue.increment(cost),
    updatedAt:       FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();

  return {
    batchId: newRef.id,
    retryOf: data.batchId,
    sent:    result.acceptedRecipientIds.length,
    failed:  failedCount,
    status:  finalStatus,
  };
});
