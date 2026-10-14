// Phase 22C — Firestore → local message feeder for the open conversation.
//
// Owns the messages listener while a conversation is open: applies remote
// changes to the local SQLite DB and pings `onChange` so the screen re-reads.
//
// Performance: only the snapshot's CHANGED documents are applied (Firestore
// re-delivers the whole 100-message window on every snapshot; re-upserting all
// of it cost ~200 statements per incoming message), in one transaction, and
// `onChange` fires only after that transaction committed — so the re-read can
// never run ahead of the write and miss the new message.

import { collection, query, orderBy, limit as qlimit, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { applyRemoteMessages } from '../repositories/messagesRepo';
import { remoteMessageInput } from './remoteMessage';

export const FEEDER_WINDOW = 100;

export interface FeederChange { ids: string[]; fromCache: boolean }

/** Start feeding one conversation's messages into the local DB. Returns unsubscribe. */
export function startConversationFeeder(
  conversationId: string,
  onChange: (change: FeederChange) => void,
  onError?: (code: string) => void,
): () => void {
  // Serialize applies so a burst of snapshots commits in order.
  let chain: Promise<void> = Promise.resolve();
  let stopped = false;
  const q = query(
    collection(db, 'conversations', conversationId, 'messages'),
    orderBy('createdAt', 'desc'),
    qlimit(FEEDER_WINDOW),
  );
  const unsub = onSnapshot(q, snap => {
    // 'removed' only means "left the 100-message window" — never a deletion
    // (deletes arrive as a modified doc with deletedForEveryone).
    const changed = snap.docChanges().filter(c => c.type !== 'removed').map(c => c.doc);
    const fromCache = snap.metadata.fromCache;
    if (changed.length === 0) { onChange({ ids: [], fromCache }); return; }
    const batch = changed.map(d => remoteMessageInput(d.id, conversationId, d.data()));
    chain = chain
      .then(() => applyRemoteMessages(batch))
      .then(() => { if (!stopped) onChange({ ids: batch.map(b => b.remoteId), fromCache }); })
      .catch(() => { if (!stopped) onError?.('local-write-failed'); });
  }, err => {
    if (__DEV__) console.warn('[feeder] messages listener failed:', (err as any)?.code ?? err);
    onError?.((err as any)?.code ?? 'unknown');
  });
  return () => { stopped = true; unsub(); };
}
