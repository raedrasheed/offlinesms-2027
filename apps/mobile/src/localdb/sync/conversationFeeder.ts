// Phase 22C — Firestore → local message feeder for the open conversation.
//
// Owns the messages listener while a conversation is open: applies remote
// changes to the local SQLite DB and pings `onChange` so the screen re-reads.
//
// Performance: only the snapshot's CHANGED documents are applied (Firestore
// re-delivers the whole 100-message window on every snapshot; re-upserting all
// of it cost ~200 statements per incoming message), in small transactions, and
// `onChange` fires only after that transaction committed — so the re-read can
// never run ahead of the write and miss the new message.

import { collection, query, orderBy, limit as qlimit, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { applyRemoteMessages } from '../repositories/messagesRepo';
import { remoteMessageInput } from './remoteMessage';
import { getCurrentUid, getDb } from '../connection';
import { perfMark, perfNow } from '../../lib/perf';

export const FEEDER_WINDOW = 100;
export const FEEDER_COMMIT_SIZE = 20;

export interface FeederChange { ids: string[]; fromCache: boolean }

/** Start feeding one conversation's messages into the local DB. Returns unsubscribe. */
export function startConversationFeeder(
  conversationId: string,
  onChange: (change: FeederChange) => void,
  onError?: (code: string) => void,
  windowSize = FEEDER_WINDOW,
): () => void {
  // Serialize applies so a burst of snapshots commits in order.
  let chain: Promise<void> = Promise.resolve();
  let stopped = false;
  let needsResync = false;
  const uid = getCurrentUid();
  const database = getDb();
  const started = perfNow();
  let firstServer = true;
  const active = () => !stopped && getCurrentUid() === uid && getDb() === database;
  const q = query(
    collection(db, 'conversations', conversationId, 'messages'),
    orderBy('createdAt', 'desc'),
    qlimit(windowSize),
  );
  const unsub = onSnapshot(q, { includeMetadataChanges: true }, snap => {
    // 'removed' only means "left the query window" — never a deletion
    // (deletes arrive as a modified doc with deletedForEveryone).
    const changed = snap.docChanges().filter(c => c.type !== 'removed').map(c => c.doc);
    const fromCache = snap.metadata.fromCache;
    if (!fromCache && firstServer) {
      firstServer = false;
      perfMark('sync:live:first-server', { durationMs: Math.round(perfNow() - started), count: snap.docs.length });
    }
    chain = chain
      .then(async () => {
        if (!active()) return;
        const batch = (needsResync ? snap.docs : changed)
          .map(d => remoteMessageInput(d.id, conversationId, d.data()));
        // A snapshot has already been acknowledged to Firestore. Losing its
        // local write and waiting for another docChanges event can lose the
        // message indefinitely, so retry the write without another network read.
        // Commit newest rows first. A full window must not hold the SQLite
        // queue until 100 messages have made their native round-trips.
        for (let offset = 0; offset < batch.length; offset += FEEDER_COMMIT_SIZE) {
          const chunk = batch.slice(offset, offset + FEEDER_COMMIT_SIZE);
          for (let attempt = 0; ; attempt++) {
            if (!active()) return;
            try { await applyRemoteMessages(chunk); break; }
            catch (error) {
              if (attempt >= 2) throw error;
              await new Promise<void>(resolve => setTimeout(resolve, 150 * (attempt + 1)));
            }
          }
          if (active()) onChange({ ids: chunk.map(b => b.remoteId), fromCache });
          // Give the post-commit read/render an opportunity before the next
          // transaction, keeping realtime batches ordered on this chain.
          if (offset + FEEDER_COMMIT_SIZE < batch.length) await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
        needsResync = false;
        if (!batch.length && active()) onChange({ ids: [], fromCache });
      })
      .catch(() => {
        needsResync = true;
        if (active()) onError?.('local-write-failed');
      });
  }, err => {
    if (__DEV__) console.warn('[feeder] messages listener failed:', (err as any)?.code ?? err);
    if (active()) onError?.((err as any)?.code ?? 'unknown');
  });
  return () => { stopped = true; unsub(); };
}
