// Callable: transferPoints — Phase 10 refactor of the Phase 0 path.
//
// Enforces self-transfer guard, frozen-wallet guard, daily cap, and
// emits canonical transfer_in / transfer_out transaction rows. Records
// the transfer to pointsTransfers/{id} for idempotency lineage; on a
// high-value transfer also emits a flags/{id} doc to the Phase 3
// moderation queue.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { writeAuditLog } from '../lib/auditLog';

const DAILY_TRANSFER_CAP_COUNT    = 20;
const DAILY_TRANSFER_CAP_POINTS   = 5000;
const FRAUD_FLAG_THRESHOLD_POINTS = 2000;

function todayKey(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

export const transferPoints = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as {
    recipientUid?: unknown;
    toUid?:        unknown;    // Phase 0 alias accepted
    amount?:       unknown;
    note?:         unknown;
  };
  const toUid = typeof data.recipientUid === 'string'
    ? data.recipientUid
    : (typeof data.toUid === 'string' ? data.toUid : '');
  if (!toUid) throw new HttpsError('invalid-argument', 'recipient-required');

  const amount = typeof data.amount === 'number' ? data.amount : 0;
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new HttpsError('invalid-argument', 'amount-invalid');
  }
  if (toUid === uid) throw new HttpsError('invalid-argument', 'self-transfer');

  const note = typeof data.note === 'string' && data.note.length > 0
    ? data.note.slice(0, 200)
    : null;

  const db = getFirestore();

  // Recipient must exist.
  const toSnap = await db.collection('users').doc(toUid).get();
  if (!toSnap.exists) throw new HttpsError('not-found', 'recipient-not-found');

  // Daily-cap pre-flight (cheap read; the real enforcement happens inside the txn).
  const day = todayKey();
  const quotaRef = db.collection('transferQuotaUsage').doc(uid).collection('days').doc(day);
  const preQuota = await quotaRef.get();
  const preCount  = (preQuota.data()?.transferCount as number) ?? 0;
  const prePoints = (preQuota.data()?.pointsTransferred as number) ?? 0;
  if (preCount + 1 > DAILY_TRANSFER_CAP_COUNT)         throw new HttpsError('resource-exhausted', 'daily-cap-count-reached');
  if (prePoints + amount > DAILY_TRANSFER_CAP_POINTS)  throw new HttpsError('resource-exhausted', 'daily-cap-points-reached');

  const idempotencyKey = randomUUID();
  const transferRef = db.collection('pointsTransfers').doc();

  await writeAuditLog({
    action: 'points.transfer.created',
    actor:  { uid },
    target: { type: 'transfer', id: transferRef.id },
    result: 'success',
    metadata: { transferId: transferRef.id, toUid, amount },
  });

  const fromRef = db.collection('wallets').doc(uid);
  const toRef   = db.collection('wallets').doc(toUid);

  let flagged = false;

  try {
    await db.runTransaction(async tx => {
      const [fromSnap, toSnap2, quotaSnap] = await Promise.all([
        tx.get(fromRef), tx.get(toRef), tx.get(quotaRef),
      ]);

      const fromStatus = (fromSnap.get('status') as string | undefined) ?? 'active';
      if (fromStatus !== 'active') {
        throw new HttpsError('failed-precondition', `wallet-${fromStatus}`);
      }
      const toStatus = (toSnap2.get('status') as string | undefined) ?? 'active';
      if (toStatus !== 'active') {
        throw new HttpsError('failed-precondition', `recipient-wallet-${toStatus}`);
      }

      const fromBal = fromSnap.exists ? ((fromSnap.get('balance') as number) ?? 0) : 0;
      const toBal   = toSnap2.exists ? ((toSnap2.get('balance')  as number) ?? 0) : 0;
      const fromReserved = fromSnap.exists ? ((fromSnap.get('reserved') as number) ?? 0) : 0;
      const fromAvailable = fromBal - fromReserved;
      if (fromAvailable < amount) {
        throw new HttpsError('failed-precondition', 'insufficient-balance');
      }

      const currentCount  = (quotaSnap.data()?.transferCount as number) ?? 0;
      const currentPoints = (quotaSnap.data()?.pointsTransferred as number) ?? 0;
      if (currentCount + 1 > DAILY_TRANSFER_CAP_COUNT)        throw new HttpsError('resource-exhausted', 'daily-cap-count-reached');
      if (currentPoints + amount > DAILY_TRANSFER_CAP_POINTS) throw new HttpsError('resource-exhausted', 'daily-cap-points-reached');

      const now = FieldValue.serverTimestamp();
      flagged = amount >= FRAUD_FLAG_THRESHOLD_POINTS;

      // Wallet balance moves.
      tx.set(fromRef, { balance: fromBal - amount, updatedAt: now }, { merge: true });
      tx.set(toRef,   { balance: toBal   + amount, updatedAt: now }, { merge: true });

      // Authoritative transfer doc.
      tx.set(transferRef, {
        fromUserId:     uid,
        toUserId:       toUid,
        amount,
        fee:            0,
        status:         'completed',
        idempotencyKey,
        flagged,
        createdAt:      now,
        completedAt:    now,
        failureReason:  null,
      });

      // Canonical transactions — one each side.
      const txOutRef = db.collection('transactions').doc();
      tx.set(txOutRef, {
        userId:            uid,
        type:              'transfer_out',
        direction:         'debit',
        amount,
        status:             'completed',
        relatedTransferId:  transferRef.id,
        relatedUserId:      toUid,
        peerId:             toUid,         // back-compat alias
        note,
        createdAt:          now,
        completedAt:        now,
      });
      const txInRef = db.collection('transactions').doc();
      tx.set(txInRef, {
        userId:            toUid,
        type:              'transfer_in',
        direction:         'credit',
        amount,
        status:             'completed',
        relatedTransferId:  transferRef.id,
        relatedUserId:      uid,
        peerId:             uid,           // back-compat alias
        note,
        createdAt:          now,
        completedAt:        now,
      });

      tx.set(quotaRef, {
        uid,
        date:              day,
        transferCount:     FieldValue.increment(1),
        pointsTransferred: FieldValue.increment(amount),
        updatedAt:         FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    const message = (e as { message?: string })?.message ?? 'failed';
    await db.collection('pointsTransfers').doc(transferRef.id).set({
      fromUserId:    uid,
      toUserId:      toUid,
      amount,
      fee:           0,
      status:        'failed',
      idempotencyKey,
      flagged:       false,
      createdAt:     FieldValue.serverTimestamp(),
      completedAt:   FieldValue.serverTimestamp(),
      failureReason: message,
    }, { merge: true });
    await writeAuditLog({
      action: 'points.transfer.failed',
      actor:  { uid },
      target: { type: 'transfer', id: transferRef.id },
      result: 'failure',
      metadata: { transferId: transferRef.id, toUid, amount, code, reason: message },
    });
    throw e;
  }

  // Fraud flag (outside the transaction — it's advisory, not mandatory).
  if (flagged) {
    await db.collection('flags').add({
      createdBy:  uid,
      targetType: 'points_transfer',
      targetId:   transferRef.id,
      reason:     'large-transfer',
      severity:   'medium',
      status:     'open',
      createdAt:  FieldValue.serverTimestamp(),
      updatedAt:  FieldValue.serverTimestamp(),
    });
    await writeAuditLog({
      action: 'points.fraud_flag.created',
      actor:  { uid: 'system' },
      target: { type: 'transfer', id: transferRef.id },
      result: 'success',
      metadata: { transferId: transferRef.id, amount, threshold: FRAUD_FLAG_THRESHOLD_POINTS },
    });
  }

  await writeAuditLog({
    action: 'points.transfer.completed',
    actor:  { uid },
    target: { type: 'transfer', id: transferRef.id },
    result: 'success',
    metadata: { transferId: transferRef.id, toUid, amount, flagged },
  });

  return { transferId: transferRef.id, amount, flagged };
});
