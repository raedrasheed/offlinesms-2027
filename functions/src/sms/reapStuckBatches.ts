// Scheduled SMS-batch reaper.
//
// Finds smsBatches stuck in 'sending' or 'accepted' for more than
// REAP_AFTER_MS, flips them to failed/partial/completed based on the
// recipient roster, releases any unrefunded reservation, and emits
// the canonical Phase 10 reservation_release + refund transactions.
//
// Idempotent: refuses to act on a batch that already has
// pointsRefunded != null (settlement was completed by
// onSmsBatchAccepted or a prior reaper run).
//
// Phase 11 ships this as code only. It is NOT exported from
// functions/src/index.ts so 'firebase deploy' won't auto-register
// the schedule. Operators flip it on by adding the export when
// they're ready. Same opt-in pattern as Phase 6's
// sweepExpiredMessages.

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';

const REAP_AFTER_MS = 15 * 60 * 1000;
const BATCH_MAX = 50;

export const reapStuckBatches = onSchedule(
  { schedule: 'every 30 minutes', timeZone: 'UTC' },
  async () => {
    const db = getFirestore();
    const cutoff = Timestamp.fromMillis(Date.now() - REAP_AFTER_MS);

    // Reap each of the two stuck statuses independently — Firestore
    // can't 'in' over a where range filter at the same time.
    for (const status of ['sending', 'accepted'] as const) {
      const snap = await db.collection('smsBatches')
        .where('status', '==', status)
        .where('createdAt', '<=', cutoff)
        .limit(BATCH_MAX)
        .get();

      for (const batchDoc of snap.docs) {
        await reapOne(db, batchDoc);
      }
    }
  },
);

async function reapOne(
  db: FirebaseFirestore.Firestore,
  batchDoc: FirebaseFirestore.QueryDocumentSnapshot,
): Promise<void> {
  const batchId = batchDoc.id;
  const batch = batchDoc.data() as {
    senderId?: string;
    recipientCount?: number;
    pointsReserved?: number;
    pointsRefunded?: number | null;
  };

  // Idempotency: settlement already done.
  if (batch.pointsRefunded != null) return;
  if (!batch.senderId) return;

  const recipientsSnap = await batchDoc.ref.collection('recipients').get();
  const recipients = recipientsSnap.docs;
  const delivered = recipients.filter(d => d.get('smsStatus') === 'delivered').length;
  const sentOrQueued = recipients.filter(d => {
    const s = d.get('smsStatus');
    return s === 'queued' || s === 'sent';
  }).length;
  const failed = recipients.filter(d => {
    const s = d.get('smsStatus');
    return s === 'failed' || s === 'undelivered';
  }).length;
  const skipped = recipients.filter(d => d.get('smsStatus') === 'skipped').length;

  // Determine the final status. Anything still 'queued' or 'sent' at
  // reaper time is treated as failed for accounting purposes — the
  // provider didn't confirm delivery in REAP_AFTER_MS.
  const treatAsFailed = failed + sentOrQueued;
  const eligible = recipients.length - skipped;
  let finalStatus: 'completed' | 'partial' | 'failed';
  if (delivered === 0 && treatAsFailed > 0)        finalStatus = 'failed';
  else if (treatAsFailed > 0)                       finalStatus = 'partial';
  else                                              finalStatus = 'completed';

  const COST_PER_SMS = 28; // mirrored from sms/recipients.ts
  const reserved   = batch.pointsReserved ?? ((batch.recipientCount ?? 0) * COST_PER_SMS);
  const actualCost = delivered * COST_PER_SMS;
  const refund     = Math.max(0, reserved - actualCost);

  const walletRef = db.collection('wallets').doc(batch.senderId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async tx => {
    const fresh = await tx.get(batchDoc.ref);
    if (!fresh.exists) return;
    const data = fresh.data() as { pointsRefunded?: number | null; status?: string };
    if (data.pointsRefunded != null) return;          // raced — another writer settled it
    if (data.status !== 'sending' && data.status !== 'accepted') return;

    const w = await tx.get(walletRef);
    const balance = w.exists ? ((w.get('balance') as number) ?? 0) : 0;
    const heldReserved = w.exists ? ((w.get('reserved') as number) ?? 0) : 0;
    tx.set(walletRef, {
      balance:  balance + refund,
      reserved: Math.max(0, heldReserved - reserved),
      updatedAt: now,
    }, { merge: true });

    // Mark every still-non-terminal recipient as failed so the report
    // is consistent with the reaped outcome.
    for (const r of recipients) {
      const s = r.get('smsStatus');
      if (s === 'queued' || s === 'sent') {
        tx.set(r.ref, {
          smsStatus: 'failed',
          failedAt: now,
          updatedAt: now,
        }, { merge: true });
      }
    }

    tx.set(batchDoc.ref, {
      status:          finalStatus,
      failedAt:        finalStatus === 'failed' ? now : null,
      completedAt:     now,
      pointsDeducted:  actualCost,
      pointsRefunded:  refund,
      failedCount:     treatAsFailed,
      deliveredCount:  delivered,
      skippedCount:    skipped,
      updatedAt:       now,
    }, { merge: true });
  });

  // Canonical transactions — outside the transaction is fine: the
  // batch doc's pointsRefunded field is the idempotency key.
  const txCol = db.collection('transactions');
  if (reserved > 0) {
    await txCol.add({
      userId:            batch.senderId,
      type:              'reservation_release',
      direction:         'credit',
      amount:            reserved,
      status:            'completed',
      relatedSmsBatchId: batchId,
      note:              'reaper',
      createdAt:         FieldValue.serverTimestamp(),
      completedAt:       FieldValue.serverTimestamp(),
    });
  }
  if (actualCost > 0) {
    await txCol.add({
      userId:            batch.senderId,
      type:              'sms_spend',
      direction:         'debit',
      amount:            actualCost,
      status:            'completed',
      sent:              delivered,
      failed:            treatAsFailed,
      relatedSmsBatchId: batchId,
      note:              'reaper',
      createdAt:         FieldValue.serverTimestamp(),
      completedAt:       FieldValue.serverTimestamp(),
    });
  }
  if (refund > 0) {
    await txCol.add({
      userId:            batch.senderId,
      type:              'refund',
      direction:         'credit',
      amount:            refund,
      status:            'completed',
      relatedSmsBatchId: batchId,
      note:              'reaper',
      createdAt:         FieldValue.serverTimestamp(),
      completedAt:       FieldValue.serverTimestamp(),
    });
  }

  await writeAuditLog({
    action: 'sms.batch.reaped',
    actor:  { uid: 'system' },
    target: { type: 'sms-batch', id: batchId },
    result: 'success',
    metadata: {
      batchId,
      finalStatus,
      delivered,
      failed: treatAsFailed,
      skipped,
      eligible,
      refund,
      actualCost,
    },
  });
}
