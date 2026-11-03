// Complete the reserved → spent/refunded lifecycle, using the immutable
// multipart unit price stored when the batch was dispatched. The settlement
// helper atomically guards against duplicate triggers and reaper races.
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { settleSmsBatch } from './settlement';

export const onSmsBatchAccepted = onDocumentUpdated('smsBatches/{batchId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after || before.status === after.status) return;
  if (!['accepted', 'partial', 'completed', 'failed'].includes(after.status)) return;
  await settleSmsBatch(getFirestore(), event.params.batchId);
});
