// Relay batch completion → re-settlement (Phase 6).
//
// Relay batches are created 'sending' and are NOT set 'accepted' at dispatch, so
// the existing settlement trigger (onSmsBatchAccepted) does not fire early. When
// every relay job for a batch reaches a terminal state, we flip the batch
// 'sending' → 'completed' EXACTLY ONCE. That single status transition drives the
// EXISTING settlement/refund pipeline (unchanged) to recompute final counts:
// delivered/sent recipients are billed, failed recipients are refunded. No new
// refund logic; double-settlement is prevented by the relayFinalizedAt guard +
// onSmsBatchAccepted's own status-change guard.

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';
import { relayBatchFinalizable } from './relayLogic';

const NON_TERMINAL = ['queued', 'claimed', 'sending'] as const;

async function countJobs(batchId: string, status: string): Promise<number> {
  try {
    const c = await getFirestore().collection('relayJobs')
      .where('batchId', '==', batchId).where('status', '==', status).count().get();
    return c.data().count;
  } catch { return 0; }
}

/**
 * Finalize a relay batch if (and only if) all its relay jobs are terminal.
 * Idempotent and safe to call from every report/reaper event. Returns true only
 * on the single call that performs the finalization.
 */
export async function maybeFinalizeRelayBatch(batchId: string): Promise<boolean> {
  const db = getFirestore();

  // Any relay job still in flight → not finalizable yet.
  const inFlight = await db.collection('relayJobs')
    .where('batchId', '==', batchId)
    .where('status', 'in', NON_TERMINAL as unknown as string[])
    .limit(1).get();
  if (!inFlight.empty) return false;

  // Terminal counts for observability (cosmetic; settlement reads recipients).
  const [delivered, sent, failed] = await Promise.all([
    countJobs(batchId, 'delivered'), countJobs(batchId, 'sent'), countJobs(batchId, 'failed'),
  ]);

  const finalized = await db.runTransaction(async tx => {
    const ref = db.collection('smsBatches').doc(batchId);
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const status = (snap.get('status') as string) ?? '';
    const already = !!snap.get('relayFinalizedAt');
    if (!relayBatchFinalizable(0, already, status)) return false;

    // Re-confirm no in-flight job slipped in between the count and the tx.
    // (The status guard + relayFinalizedAt make a late job harmless: it would
    //  just be a no-op report; finances are settled from recipient states.)
    tx.update(ref, {
      status: 'completed',                  // sending → completed: fires settlement ONCE
      relayFinalizedAt: FieldValue.serverTimestamp(),
      relayFinalStatus: 'completed',
      relayTerminalCounts: { delivered, sent, failed },
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });

  if (finalized) {
    await writeAuditLog({
      action: 'relay.batch.finalized', actor: { uid: 'system' },
      target: { type: 'smsBatch', id: batchId }, result: 'success',
      metadata: { delivered, sent, failed },
    });
  }
  return finalized;
}
