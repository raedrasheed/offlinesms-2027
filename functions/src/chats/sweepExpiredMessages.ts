// Disappearing-message sweeper.
//
// Periodically flips messages whose expiresAt has passed to
// deletedForEveryone:true with deleteReason:'expired'. Code only — Phase 6
// does NOT wire this into firebase.json's schedules. Activation is queued
// for Phase 11 once the client-side TTL setting UI lands and we want the
// real-time guarantee. Until then this stays importable but unscheduled.

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

const BATCH_MAX = 200;

export const sweepExpiredMessages = onSchedule(
  // Every hour. Adjust when scheduling is activated.
  { schedule: 'every 60 minutes', timeZone: 'UTC' },
  async () => {
    const db = getFirestore();
    const now = Timestamp.now();

    // Collection-group query: messages where expiresAt <= now AND
    // deletedForEveryone is not yet true.
    const snap = await db
      .collectionGroup('messages')
      .where('expiresAt', '<=', now)
      .where('deletedForEveryone', '==', false)
      .limit(BATCH_MAX)
      .get();

    if (snap.empty) return;

    const batch = db.batch();
    const serverNow = FieldValue.serverTimestamp();
    for (const doc of snap.docs) {
      batch.update(doc.ref, {
        text:               '',
        deletedForEveryone: true,
        deletedAt:          serverNow,
        deletedBy:          null,
        deleteReason:       'expired',
        reactions:          null,
        updatedAt:          serverNow,
      });
    }
    await batch.commit();
  },
);
