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
import { COST_PER_SMS, MAX_BATCHES_PER_DAY, maskPhone, todayKey } from './recipients';
import { writeAuditLog } from '../lib/auditLog';

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
    conversationId?: string;
    messageId?: string;
    smsBody?: string;
    audience?: string;
    audienceCanonical?: string;
  };
  const token = (request.auth?.token ?? {}) as Record<string, unknown>;
  const senderIsAdmin =
    token.admin === true ||
    ['super_admin', 'organization_admin'].includes((token.role as string) ?? '');
  if (source.senderId !== uid && !senderIsAdmin) {
    throw new HttpsError('permission-denied', 'not-batch-owner');
  }

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
      .where('senderId',  '==', uid)
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
  const failed: Failed[] = [];
  const skippedByDedupe: string[] = [];
  for (const r of failedSnap.docs) {
    if (alreadySent.has(r.id)) {
      skippedByDedupe.push(r.id);
      continue;
    }
    const u = await db.collection('users').doc(r.id).get();
    const phone = u.data()?.phoneNumber as string | undefined;
    if (!phone) continue;
    failed.push({
      uid: r.id,
      phone,
      maskedPhone: maskPhone(phone),
      appReceiptStatus: (r.data() as { appReceiptStatus?: string }).appReceiptStatus ?? null,
    });
  }
  if (failed.length === 0) throw new HttpsError('failed-precondition', 'no-eligible-failed-recipients');

  // Reserve points for the retry batch.
  const cost = failed.length * COST_PER_SMS;
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

  // Create the retry batch.
  const newRef = db.collection('smsBatches').doc();
  const now = FieldValue.serverTimestamp();
  await newRef.set({
    messageId:         source.messageId ?? null,
    conversationId:    source.conversationId ?? null,
    senderId:          uid,
    audience:          source.audience ?? source.audienceCanonical ?? 'everyone',
    audienceCanonical: source.audienceCanonical ?? 'everyone',
    smsBody:           source.smsBody ?? '',
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
