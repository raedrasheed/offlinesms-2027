// Phase 22C — one-time import of the legacy AsyncStorage outgoing queue
// (offlineQueue) into the SQLite outbox.
//
// Safety: items remaining in the legacy queue are undelivered — the old
// OfflineContext drain removed an item only after the server confirmed it — so
// re-sending them through the outbox cannot duplicate already-delivered
// messages. Guarded by a sync_state flag so it runs at most once per device.

import { getQueue, removeQueued } from '../../lib/offlineQueue';
import { getState, setState } from '../repositories/syncStateRepo';
import { queueSendMessage } from '../index';

let ranThisSession = false;

export async function importLegacyQueueOnce(uid: string): Promise<void> {
  if (ranThisSession) return;
  if ((await getState('legacy_queue_migrated')) === '1') { ranThisSession = true; return; }
  try {
    const items = await getQueue();
    for (const q of items) {
      await queueSendMessage({
        conversationId: q.conversationId,
        senderUid: uid,
        text: q.text,
        replyTo: q.replyTo ?? null,
      });
      await removeQueued(q.localQueueId);
    }
    await setState('legacy_queue_migrated', '1');
    ranThisSession = true;
  } catch {
    // Leave the flag unset so a later open retries the import.
  }
}
