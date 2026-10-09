// Local-data performance harness — the app's REAL repositories, feeders and
// view-model code on a real SQLite engine (sql.js), with Firestore replaced by
// an in-memory fake that mirrors snapshot semantics (whole window in `docs`,
// only changes in `docChanges()`). Version-agnostic: it only uses APIs present
// before and after the performance work, so the same file measures both
// (PERF_LABEL=baseline in a worktree of the pre-change commit, PERF_LABEL=after
// here). Writes __perf__/results/<PERF_LABEL>.json.
//
// What this does NOT model: device CPU, the async native round-trip of each
// expo-sqlite call (reported instead as `statements`), network latency and
// React rendering (reported as `changedObjects` — Message objects whose
// identity changed, i.e. bubbles MessageBubble's memo must re-render).

import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSqlJsDb, type CountingDb } from '../__tests__/support/sqljsDb';
import { seed, measure, DATASET, T0, type Measure } from './fixtures';
import { firestoreMock, fakeSeed, fakeWrite, fakeTs, resetFake } from '../__tests__/support/fakeFirestore';

let db: CountingDb;
vi.mock('../src/localdb/connection', () => ({
  getDb: () => db, getCurrentUid: () => 'u_me', openForUser: async () => db,
  closeDb: async () => {}, wipeUserData: async () => {},
}));
vi.mock('firebase/firestore', () => firestoreMock);
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}), httpsCallable: () => async () => ({ data: {} }) }));
vi.mock('firebase/storage', () => ({}));
vi.mock('../src/lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u_me' } }, storage: {}, app: {}, functions: {} }));
vi.mock('../src/localdb/sync/syncScheduler', () => ({
  kick: () => {}, setActiveConversation: () => {}, startScheduler: () => {}, stopScheduler: () => {},
  getActiveConversationId: () => undefined,
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' }, AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock('expo-file-system', () => ({}));
vi.mock('../src/localdb/sync/firebasePush', () => ({ pushOutboxItem: async () => ({}) }));
vi.mock('@react-native-community/netinfo', () => ({ default: { addEventListener: () => () => {}, fetch: async () => ({ isConnected: true }) } }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {} } }));

const label = process.env.PERF_LABEL ?? 'run';
const results: Measure[] = [];
const plans: Record<string, string[]> = {};
const extra: Record<string, number> = {};

const H = DATASET.heavyConversationId;
const msgDoc = (k: number) => ({
  senderUid: k % 2 ? 'u_me' : 'u_peer', senderDisplayName: 'Peer', type: 'text',
  text: `message ${k} in ${H}`, createdAt: fakeTs(T0 + k * 60_000),
  reactions: k % 10 === 0 ? { '👍': ['u_peer'] } : null, deliveredCount: 1, readCount: 1,
});

describe(`local data performance [${label}]`, () => {
  beforeAll(async () => {
    db = await createSqlJsDb();
    await seed(db);
    resetFake();
    // The server-side window the realtime listener sees (newest 100).
    for (let k = DATASET.heavyMessages - 100; k < DATASET.heavyMessages; k++) {
      fakeSeed(`conversations/${H}/messages/${H}_m${k}`, msgDoc(k));
    }
  });

  afterAll(() => {
    const dir = join(__dirname, 'results');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${label}.json`), JSON.stringify({ label, dataset: DATASET, results, plans, extra }, null, 2));
    // eslint-disable-next-line no-console
    console.table(results.map(r => ({ name: r.name, medianMs: r.medianMs, p95Ms: r.p95Ms, statements: r.statements })));
    // eslint-disable-next-line no-console
    console.log(extra);
    db.close();
  });

  it('measures', async () => {
    const conversationsRepo = await import('../src/localdb/repositories/conversationsRepo');
    const messagesRepo = await import('../src/localdb/repositories/messagesRepo');
    const { mapConversationRow } = await import('../src/hooks/chatListModel');
    const messageModel: any = await import('../src/hooks/messageModel');
    const { startConversationFeeder } = await import('../src/localdb/sync/conversationFeeder');
    const { startChatListFeeder } = await import('../src/localdb/sync/chatListFeeder');
    const localdb = await import('../src/localdb');

    plans.listMessages = await db.plan(
      `SELECT * FROM messages WHERE conversation_id = ? AND deleted_for_me = 0 ORDER BY COALESCE(remote_created_at, created_at) DESC LIMIT ?`, [H, 100]);
    plans.listConversations = await db.plan(
      `SELECT * FROM conversations WHERE archived = 0 ORDER BY last_message_at DESC NULLS LAST`);

    // 1. Chat list first paint (local read + mapping).
    results.push(await measure(db, 'chatList.read+map (200 chats)', 30, async () => {
      (await conversationsRepo.listConversations({ includeArchived: false })).map(mapConversationRow);
    }));

    // 2. Conversation open: newest 100 rows + mapping.
    results.push(await measure(db, 'conversation.open (100 of 20k)', 30, async () => {
      messageModel.mapAndOrderMessages(await messagesRepo.listMessages(H, 100));
    }));
    results.push(await measure(db, 'conversation.open (100 of 200)', 30, async () => {
      messageModel.mapAndOrderMessages(await messagesRepo.listMessages('c_3', 100));
    }));

    // 3. One new message arrives while the chat is open: the REAL feeder applies
    //    the snapshot to SQLite, then the screen re-reads. Timed from the server
    //    write to the feeder's onChange (write committed) + the re-read.
    let resolveChange: (() => void) | null = null;
    const stop = startConversationFeeder(H, () => { resolveChange?.(); });
    await new Promise(r => setTimeout(r, 50)); // initial snapshot (window already stored)
    let k = DATASET.heavyMessages;
    results.push(await measure(db, 'newMessage.feederApply+refresh', 15, async () => {
      const changed = new Promise<void>(r => { resolveChange = r; });
      fakeWrite(`conversations/${H}/messages/${H}_m${k}`, msgDoc(k)); k++;
      await changed;
      messageModel.mapAndOrderMessages(await messagesRepo.listMessages(H, 100));
    }, 'server write → feeder committed → re-read'));
    stop();

    // 4. Render churn after one new message: Message objects whose identity
    //    changed between two refreshes (= bubbles that re-render).
    const mapper = typeof messageModel.createMessageMapper === 'function'
      ? messageModel.createMessageMapper() : (rows: any[]) => messageModel.mapAndOrderMessages(rows);
    const before = mapper(await messagesRepo.listMessages(H, 100)) as any[];
    fakeSeed('x/y', {}); // no-op
    await messagesRepo.upsertRemoteMessage({ remoteId: `${H}_mX`, conversationId: H, senderUid: 'u_peer', text: 'new', remoteCreatedAt: T0 + 10 ** 12 });
    const after = mapper(await messagesRepo.listMessages(H, 100)) as any[];
    const prevById = new Map(before.map(m => [m.id, m]));
    extra.changedObjectsAfterOneNewMessage = after.filter(m => prevById.get(m.id) !== m).length;

    // 5. Older messages: the 10th "load older" page (window grown to 1000).
    results.push(await measure(db, 'loadOlder.page10 (window 1000)', 15, async () => {
      messageModel.mapAndOrderMessages(await messagesRepo.listMessages(H, 1000));
    }));

    // 6. Send: optimistic local insert + outbox enqueue.
    results.push(await measure(db, 'send.queueSendMessage', 30, async (i) => {
      await localdb.queueSendMessage({ conversationId: 'c_5', senderUid: 'u_me', text: `hello ${label} ${i}` });
    }));

    // 7. Chat list: a new message in one of 50 chats (conversation + userState
    //    update) through the REAL chat-list feeder, until the list re-read.
    for (let c = 0; c < 50; c++) {
      const id = c === 0 ? H : `c_${c}`;
      fakeSeed(`conversations/${id}`, { type: 'direct', participantUids: ['u_me', 'u_peer'], lastMessageText: 'hi', updatedAt: fakeTs(T0 + c), memberCount: 2 });
      fakeSeed(`conversations/${id}/userState/u_me`, { unreadCount: 0 });
    }
    fakeSeed('users/u_peer', { displayName: 'Peer' });
    let onListChange: (() => void) | null = null;
    const stopList = startChatListFeeder('u_me', () => { onListChange?.(); });
    await new Promise(r => setTimeout(r, 200)); // initial snapshots settle
    let round = 0;
    results.push(await measure(db, 'chatList.newMessage feederApply+read', 15, async () => {
      round++;
      let pending = 2; // conversation doc + userState doc
      const done = new Promise<void>(r => { onListChange = () => { if (--pending <= 0) r(); }; });
      fakeWrite(`conversations/c_7`, { type: 'direct', participantUids: ['u_me', 'u_peer'], lastMessageText: `m${round}`, updatedAt: fakeTs(T0 + 10_000 + round), memberCount: 2 });
      fakeWrite(`conversations/c_7/userState/u_me`, { unreadCount: round });
      await done;
      (await conversationsRepo.listConversations({ includeArchived: false })).map(mapConversationRow);
    }, 'server write → feeder committed → list re-read'));
    stopList();
  });
});
