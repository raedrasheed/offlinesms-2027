import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createSqlJsDb, type CountingDb } from '../support/sqljsDb';
import { firestoreMock, fakeSeed, fakeWrite, fakeTs, resetFake } from '../support/fakeFirestore';

const state = vi.hoisted(() => ({
  uid: 'me', online: true, foreground: 'active',
  app: new Set<(s: string) => void>(), network: new Set<(s: boolean) => void>(),
}));
let db: CountingDb;
vi.mock('../../src/localdb/connection', () => ({ getDb: () => db, getCurrentUid: () => state.uid }));
vi.mock('firebase/firestore', () => firestoreMock);
vi.mock('firebase/firestore/lite', () => ({ ...firestoreMock, getFirestore: () => ({}) }));
vi.mock('../../src/lib/firebase', () => ({ app: {}, db: {}, auth: { get currentUser() { return { uid: state.uid }; } } }));
vi.mock('../../src/lib/userProfiles', () => ({ profileStore: { peek: () => undefined, request: () => {}, subscribe: () => () => {} } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-native', () => ({ AppState: {
  get currentState() { return state.foreground; },
  addEventListener: (_: string, cb: (s: string) => void) => { state.app.add(cb); return { remove: () => state.app.delete(cb) }; },
} }));
vi.mock('../../src/localdb/sync/networkState', () => ({
  isOnline: () => state.online,
  onConnectivityChange: (cb: (s: boolean) => void) => { state.network.add(cb); return () => state.network.delete(cb); },
}));
vi.mock('../../src/localdb/sync/legacyImport', () => ({ importLegacyQueueOnce: async () => {} }));
vi.mock('../../src/localdb', async () => ({
  openLocalDb: async () => {}, initLocalDb: async () => {}, setActiveConversation: () => {}, clearChat: async () => 0,
  conversationsRepo: await import('../../src/localdb/repositories/conversationsRepo'),
  messagesRepo: await import('../../src/localdb/repositories/messagesRepo'),
  getChatClearedAt: async (id: string) => (await import('../../src/localdb/repositories/syncStateRepo')).getCursor(`chat_cleared:${id}`),
  notificationTargets: { subscribe: () => () => {}, request: async () => 'ready', retry: async () => 'ready' },
}));
import { useLocalChatList, type LocalChatList } from '../../src/hooks/useLocalChatList';
import { useLocalConversation, type LocalConversation } from '../../src/hooks/useLocalConversation';
import { listMessages } from '../../src/localdb/repositories/messagesRepo';
import { getConversation } from '../../src/localdb/repositories/conversationsRepo';
import { setCursor } from '../../src/localdb/repositories/syncStateRepo';

let list: LocalChatList;
let conversation: LocalConversation;
let renderer: ReactTestRenderer | undefined;
function List() { list = useLocalChatList(state.uid); return null; }
function Chat() { conversation = useLocalConversation('c', state.uid); return null; }
const summary = (k: number) => ({ type: 'group', name: 'Chat', participantUids: ['me'],
  updatedAt: fakeTs(1000 + k), lastMessage: { messageId: `m${k}`, preview: `message ${k}`, createdAt: fakeTs(k) } });
const message = (k: number) => ({ senderUid: 'peer', type: 'text', text: `message ${k}`, createdAt: fakeTs(k) });
async function mountList() { await act(async () => { renderer = create(createElement(List)); }); }
async function settle() { await act(async () => { await new Promise(r => setTimeout(r, 10)); }); }
async function waitMessage(id: string) {
  await act(async () => { await vi.waitFor(async () => expect((await listMessages('c')).map(m => m.remote_id)).toContain(id)); });
}
beforeEach(async () => {
  vi.stubGlobal('__DEV__', false); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  db = await createSqlJsDb(); resetFake(); state.uid = 'me'; state.online = true; state.foreground = 'active';
  fakeSeed('conversations/c', summary(1));
  fakeSeed('conversations/c/userState/me', { unreadCount: 2 });
  fakeSeed('conversations/c/messages/m1', message(1));
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined; await new Promise(r => setTimeout(r, 10));
  expect(state.app.size).toBe(0); expect(state.network.size).toBe(0);
  db.close(); vi.unstubAllGlobals();
});

describe('chat list preloading into real SQLite', () => {
  it('limits a preloaded conversation to the newest 25 rows', async () => {
    for (let k = 2; k <= 100; k++) fakeSeed(`conversations/c/messages/m${k}`, message(k));
    fakeSeed('conversations/c', summary(100));
    await mountList(); await waitMessage('m76'); await settle();
    const rows = await listMessages('c', 200);
    expect(rows).toHaveLength(25);
    expect(rows[0].remote_id).toBe('m100');
    expect(rows.at(-1)?.remote_id).toBe('m76');
  });

  it('stores new messages before a conversation opens, without marking them read', async () => {
    await mountList(); await waitMessage('m1');
    await act(async () => {
      fakeWrite('conversations/c/messages/m2', message(2));
      fakeWrite('conversations/c', summary(2));
    });
    await waitMessage('m2'); await settle();
    expect(list.items[0].state.unreadCount).toBe(2);
    expect(await getConversation('c')).toMatchObject({ last_message_id: 'm2', last_message_at: 2, unread_count: 2 });
    expect(await db.first('SELECT COUNT(*) AS n FROM outbox')).toEqual({ n: 0 });
    // Open with all incoming network work stalled. The first local read has m2.
    state.online = false; state.network.forEach(cb => cb(false));
    const listen = vi.spyOn(firestoreMock, 'onSnapshot').mockReturnValue(() => {});
    try {
      await act(async () => { renderer!.update(createElement(Chat)); });
      expect(conversation.loading).toBe(false);
      expect(conversation.messages.map(m => m.id)).toEqual(['m1', 'm2']);
      expect(conversation.live).toBe('offline');
    } finally { listen.mockRestore(); }
  });

  it('pauses message listeners in background and catches up on foreground', async () => {
    await mountList(); await waitMessage('m1');
    state.foreground = 'background'; state.app.forEach(cb => cb('background'));
    fakeWrite('conversations/c/messages/m2', message(2));
    await act(async () => { fakeWrite('conversations/c', summary(2)); });
    await settle();
    expect((await listMessages('c')).map(m => m.remote_id)).toEqual(['m1']);
    await act(async () => { state.foreground = 'active'; state.app.forEach(cb => cb('active')); });
    await waitMessage('m2');
  });

  it('keeps the clear-history watermark when preloaded rows are displayed', async () => {
    await setCursor('chat_cleared:c', 1);
    fakeSeed('conversations/c/messages/m2', message(2));
    await mountList(); await waitMessage('m2');
    await act(async () => { renderer!.update(createElement(Chat)); });
    expect(conversation.loading).toBe(false);
    expect(conversation.messages.map(m => m.id)).toEqual(['m2']);
  });

  it('does not commit a queued preloader snapshot after the signed-in user changes', async () => {
    await mountList(); await waitMessage('m1');
    fakeWrite('conversations/c/messages/m2', message(2));
    state.uid = 'other';
    await settle();
    expect((await listMessages('c')).map(m => m.remote_id)).toEqual(['m1']);
  });

  it('does not commit an old listener into a replacement database for the same user', async () => {
    await mountList(); await waitMessage('m1');
    const replacement = await createSqlJsDb();
    const previous = db;
    fakeWrite('conversations/c/messages/m2', message(2));
    db = replacement;
    await settle();
    expect(await listMessages('c')).toEqual([]);
    previous.close();
  });
});
