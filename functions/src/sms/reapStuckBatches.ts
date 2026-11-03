// Opt-in stale SMS batch recovery. Uses the same atomic settlement guard and
// snapshot segment price as normal gateway/relay completion. This schedule is
// intentionally not exported from index.ts until operators enable it.
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';
import { settleSmsBatch } from './settlement';

const REAP_AFTER_MS = 15 * 60 * 1000;
const BATCH_MAX = 50;
export const reapStuckBatches = onSchedule(
  { schedule: 'every 30 minutes', timeZone: 'UTC' },
  async () => {
    const db = getFirestore();
    const cutoff = Timestamp.fromMillis(Date.now() - REAP_AFTER_MS);
    for (const status of ['sending', 'accepted'] as const) {
      const batches = await db.collection('smsBatches').where('status', '==', status)
        .where('createdAt', '<=', cutoff).limit(BATCH_MAX).get();
      for (const batch of batches.docs) {
        const result = await settleSmsBatch(db, batch.id, true);
        if (!result) continue;
        await writeAuditLog({
          action: 'sms.batch.reaped', actor: { uid: 'system' },
          target: { type: 'sms-batch', id: batch.id }, result: 'success',
          metadata: { batchId: batch.id, ...result },
        });
      }
    }
  },
);
