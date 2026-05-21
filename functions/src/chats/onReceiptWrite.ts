// Receipt aggregation trigger.
//
// Recomputes the parent message's aggregate counts after any change to a
// receipt doc. Reading all receipts on every write keeps the logic simple
// and correct; with the Phase 5 group cap (256 members), the worst case is
// reading 256 docs per receipt event, which is acceptable. If receipt
// throughput becomes a hotspot, Phase 20 can swap to incremental
// FieldValue.increment-based counters with a daily reconciliation.

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

type Status = 'pending' | 'delivered' | 'read' | 'viewed' | 'played' | 'failed';

export const onReceiptWrite = onDocumentWritten(
  'conversations/{convoId}/messages/{messageId}/receipts/{uid}',
  async (event) => {
    const { convoId, messageId } = event.params as { convoId: string; messageId: string };
    const db = getFirestore();
    const msgRef = db.collection('conversations').doc(convoId).collection('messages').doc(messageId);

    const receiptsSnap = await msgRef.collection('receipts').get();
    const counts: Record<Status, number> = {
      pending: 0, delivered: 0, read: 0, viewed: 0, played: 0, failed: 0,
    };
    for (const d of receiptsSnap.docs) {
      const s = ((d.data() as { status?: string }).status ?? 'pending') as Status;
      if (s in counts) counts[s] += 1;
    }

    await msgRef.update({
      deliveredCount:   counts.delivered + counts.read + counts.viewed + counts.played,
      readCount:        counts.read,
      viewedCount:      counts.viewed + counts.read, // text: read implies viewed
      playedCount:      counts.played,
      failedCount:      counts.failed,
      pendingCount:     counts.pending,
      receiptUpdatedAt: FieldValue.serverTimestamp(),
    });
  },
);
