// Phase 22 — pull: read remote changes into the local DB. Cursor-based and
// incremental; prioritizes the active conversation. Firestore access lives here
// (inside the sync layer) — screens never query Firestore directly once cut
// over. Reads are one-shot getDocs (the sync engine schedules them) and use
// per-collection high-water marks so each run only fetches what changed since
// the last pull. Realtime feeders own live updates for the open conversation
// (including edits/deletes), so this catch-up path can key on createdAt safely.

import {
  collection, query, where, orderBy, limit as qlimit, getDocsFromServer as getDocs, doc, getDocFromServer as getDoc, Timestamp, startAfter, documentId,
} from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { upsertRemoteConversation, applyUserState } from '../repositories/conversationsRepo';
import { applyRemoteMessages } from '../repositories/messagesRepo';
import { remoteMessageInput } from './remoteMessage';
import { upsertMember } from '../repositories/membersRepo';
import { getCurrentUid, getDb, type LocalDatabase } from '../connection';
import { getCursor, getState, setState } from '../repositories/syncStateRepo';
import { readRecentMessages, readMessageById } from './messageReads';
import { perfMark, perfNow } from '../../lib/perf';

const CONV_PAGE = 50;
const MSG_PAGE = 50;

function ms(ts: any): number | null {
  return ts?.toMillis?.() ?? null;
}

/**
 * Pull conversations changed since the last pull (and fold in per-user state).
 * Incremental: queries `updatedAt > cursor` ascending and advances the
 * `last_conversations_pull_at` high-water mark to the newest doc seen, so steady
 * state fetches only what changed instead of re-reading the whole list.
 */
export async function pullConversations(): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const since = await getCursor('last_conversations_pull_at');
  const saved = await getState('conversations_cursor_v2');
  let cursor: PageCursor | null = saved ? JSON.parse(saved) : null;
  for (let page = 0; page < 8; page++) {
    const snap = await getDocs(query(
      collection(db, 'conversations'), where('participantUids', 'array-contains', uid),
      where('updatedAt', '>=', Timestamp.fromMillis(since)),
      orderBy('updatedAt', 'asc'), orderBy(documentId(), 'asc'),
      ...(cursor ? [after(cursor)] : []), qlimit(CONV_PAGE),
    ));
    assertUser(uid);
    for (const d of snap.docs) {
      const c = d.data() as any;
      await upsertRemoteConversation({
        id: d.id, remote_id: d.id, type: c.type === 'group' ? 'group' : 'direct',
        title: c.name ?? null, avatar_url: c.photoURL ?? null,
        owner_uid: c.ownerUid ?? null, status: c.status ?? 'active', member_count: c.memberCount ?? 0,
        pinned_message_id: c.pinnedMessage?.messageId ?? null, last_message_id: c.lastMessage?.messageId ?? null,
        last_message_preview: c.lastMessage?.preview ?? c.lastMessageText ?? null,
        last_message_at: ms(c.lastMessage?.createdAt ?? c.lastMessageAt ?? c.updatedAt),
        remote_updated_at: ms(c.updatedAt),
      });
    }
    // Bound per-user state reads rather than starting 50 requests at once.
    for (let offset = 0; offset < snap.docs.length; offset += 4) {
      await Promise.all(snap.docs.slice(offset, offset + 4).map(async d => {
        try {
          const state = await getDoc(doc(db, 'conversations', d.id, 'userState', uid));
          assertUser(uid);
          if (!state.exists()) return;
          const s = state.data();
          await applyUserState(d.id, { unread_count: s.unreadCount ?? 0, muted: s.muted ? 1 : 0,
            pinned: s.pinned ? 1 : 0, favorite: s.favorite ? 1 : 0, archived: s.archived ? 1 : 0 });
        } catch { /* the user-state feeder also reconciles these flags */ }
      }));
    }
    assertUser(uid);
    const last = snap.docs[snap.docs.length - 1];
    if (last) { cursor = cursorOf(last, 'updatedAt'); await setState('conversations_cursor_v2', JSON.stringify(cursor)); }
    if (snap.size < CONV_PAGE) break;
  }
}

// Persist the complete server timestamp and document id. Millisecond-only
// cursors stall/skip when a page contains messages with the same timestamp.
interface PageCursor { seconds: number; nanoseconds: number; id: string }
function cursorOf(d: { id: string; data(): any }, field = 'createdAt'): PageCursor {
  const t = d.data()[field];
  return { seconds: t.seconds, nanoseconds: t.nanoseconds, id: d.id };
}
function after(c: PageCursor) { return startAfter(new Timestamp(c.seconds, c.nanoseconds), c.id); }
function assertUser(uid: string | null) {
  if (getCurrentUid() !== uid || auth.currentUser?.uid !== uid) throw new Error('sync-session-changed');
}
const forwardFlights = new Map<string, Promise<number>>();

const recentFlights = new Map<string, { database: LocalDatabase; task: Promise<number> }>();
/** Newest first on EVERY open, even with a deep gap or an in-flight backfill.
 * This short REST read does not advance either completeness cursor. The live
 * feed reconciles existing rows; history/catch-up still fill the entire gap.
 */
export function pullRecentMessages(conversationId: string): Promise<number> {
  const uid = getCurrentUid();
  const database = getDb();
  const key = `${uid}/${conversationId}`;
  const existing = recentFlights.get(key);
  if (existing?.database === database) return existing.task;
  const task = (async () => {
    assertUser(uid);
    const batch = await readRecentMessages(conversationId);
    assertUser(uid);
    if (getDb() !== database) throw new Error('sync-session-changed');
    const started = perfNow();
    await applyRemoteMessages(batch, { insertOnly: true });
    perfMark('sync:recent:commit', { durationMs: Math.round(perfNow() - started), count: batch.length });
    return batch.length;
  })().finally(() => { if (recentFlights.get(key)?.task === task) recentFlights.delete(key); });
  recentFlights.set(key, { database, task });
  return task;
}

/** Bounded catch-up; a complete tuple cursor resumes the next run exactly. */
export function pullMessages(conversationId: string, max = MSG_PAGE, pages = 8): Promise<number> {
  const uid = getCurrentUid();
  const flightKey = `${uid}/${conversationId}`;
  const existing = forwardFlights.get(flightKey);
  if (existing) return existing;
  const task = (async () => {
    const key = `msg_cursor_v2:${conversationId}` as const;
    const saved = await getState(key);
    let cursor: PageCursor | null = saved ? JSON.parse(saved) : null;
    const since = Math.max(await getCursor(`msg_cursor:${conversationId}`), await getCursor(`chat_cleared:${conversationId}`));
    // A new device starts with RECENT messages. History has its own durable
    // backward cursor and cannot infer completeness from this recent window.
    if (!cursor && since <= 0) {
      const recent = await getDocs(query(collection(db, 'conversations', conversationId, 'messages'),
        orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'), qlimit(max)));
      assertUser(uid);
      await applyRemoteMessages(recent.docs.map(d => remoteMessageInput(d.id, conversationId, d.data())));
      if (recent.docs[0]) await setState(key, JSON.stringify(cursorOf(recent.docs[0])));
      return recent.size;
    }
    let total = 0;
    for (let page = 0; page < pages; page++) {
      const snap = await getDocs(query(
        collection(db, 'conversations', conversationId, 'messages'),
        where('createdAt', '>=', Timestamp.fromMillis(since)),
        orderBy('createdAt', 'asc'), orderBy(documentId(), 'asc'),
        ...(cursor ? [after(cursor)] : []), qlimit(max),
      ));
      assertUser(uid);
      await applyRemoteMessages(snap.docs.map(d => remoteMessageInput(d.id, conversationId, d.data())));
      total += snap.size;
      const last = snap.docs[snap.docs.length - 1];
      if (last) { cursor = cursorOf(last); await setState(key, JSON.stringify(cursor)); }
      if (snap.size < max) break;
      // Let notification/UI work run between history pages.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return total;
  })().finally(() => { forwardFlights.delete(flightKey); });
  forwardFlights.set(flightKey, task);
  return task;
}

const historyFlights = new Map<string, Promise<number>>();
/** A backward frontier owned by SERVER pages, never the oldest local row.
 * Version 2 deliberately ignores old done flags: they could hide middle gaps.
 * The first page starts at the server's newest document, without a device clock.
 */
export function pullMessageHistoryPage(conversationId: string, max = 100): Promise<number> {
  const uid = getCurrentUid();
  const flightKey = `${uid}/${conversationId}`;
  const existing = historyFlights.get(flightKey);
  if (existing) return existing;
  const task = (async () => {
    const key = `history_v2:${conversationId}` as const;
    const raw = await getState(key);
    const saved: { cursor?: PageCursor; done?: boolean } = raw ? JSON.parse(raw) : {};
    if (saved.done) return 0;
    const floor = await getCursor(`chat_cleared:${conversationId}`);
    const snap = await getDocs(query(
      collection(db, 'conversations', conversationId, 'messages'),
      ...(floor > 0 ? [where('createdAt', '>', Timestamp.fromMillis(floor))] : []),
      orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'),
      ...(saved.cursor ? [after(saved.cursor)] : []), qlimit(max),
    ));
    assertUser(uid);
    await applyRemoteMessages(snap.docs.map(d => remoteMessageInput(d.id, conversationId, d.data())));
    const last = snap.docs[snap.docs.length - 1];
    await setState(key, JSON.stringify({ cursor: last ? cursorOf(last) : saved.cursor, done: snap.size < max }));
    return snap.size;
  })().finally(() => { historyFlights.delete(flightKey); });
  historyFlights.set(flightKey, task);
  return task;
}

/**
 * Fetch ONE message by id and store it locally — the notification path. A push
 * names the exact message, so opening the chat must not wait for a page pull,
 * a history backfill or the realtime listener's first snapshot. One document
 * read; idempotent (keyed by remote id, so it can never duplicate the message
 * the feeder or a pull also delivers). Returns false if the message doesn't
 * exist (deleted) or isn't readable.
 */
export async function pullMessageById(conversationId: string, messageId: string): Promise<boolean> {
  const uid = getCurrentUid();
  const database = getDb();
  assertUser(uid);
  const message = await readMessageById(conversationId, messageId);
  assertUser(uid);
  if (!message) return false;
  if (getDb() !== database) throw new Error('sync-session-changed');
  // Targeted retries also finish an existing image/voice upload, so unlike the
  // recent bootstrap they must reconcile an incomplete local media row.
  await applyRemoteMessages([message]);
  return true;
}

/**
 * Backfill older messages from Firestore (those created strictly before
 * `beforeMs`), for paging back through history that retention has evicted or
 * that the forward pull never reached. Does not move the forward cursor.
 * Returns how many docs were fetched (0 means no older history remains).
 *
 * `afterMs` (default 0) sets an exclusive lower bound: pass a "clear chat"
 * watermark so paging never crosses it and resurrects cleared history.
 */
export async function pullMessagesBefore(conversationId: string, beforeMs: number, afterMs = 0, max = MSG_PAGE): Promise<number> {
  const constraints = [
    where('createdAt', '<', Timestamp.fromMillis(beforeMs)),
    ...(afterMs > 0 ? [where('createdAt', '>', Timestamp.fromMillis(afterMs))] : []),
    orderBy('createdAt', 'desc'),
    qlimit(max),
  ];
  const snap = await getDocs(query(
    collection(db, 'conversations', conversationId, 'messages'),
    ...constraints,
  ));
  // Same mapper as the live path: older photos / voice notes keep their type,
  // caption and media instead of arriving as empty text rows.
  await applyRemoteMessages(snap.docs.map(d => remoteMessageInput(d.id, conversationId, d.data())));
  return snap.size;
}

/** Pull group members for a conversation. */
export async function pullMembers(conversationId: string): Promise<void> {
  const uid = getCurrentUid();
  const database = getDb();
  assertUser(uid);
  const snap = await getDocs(collection(db, 'conversations', conversationId, 'members'));
  for (const d of snap.docs) {
    assertUser(uid);
    if (getDb() !== database) throw new Error('sync-session-changed');
    const m = d.data() as any;
    await upsertMember({
      conversationId,
      uid: d.id,
      displayName: m.displayNameSnapshot ?? null,
      photoUrl: m.photoURLSnapshot ?? null,
      role: m.role ?? 'member',
      status: m.status ?? 'active',
      joinedAt: ms(m.joinedAt),
    });
  }
}
