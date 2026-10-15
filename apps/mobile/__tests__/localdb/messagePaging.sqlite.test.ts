import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createSqlJsDb, type CountingDb } from '../support/sqljsDb';
import { firestoreMock, fakeSeed, fakeTs, resetFake } from '../support/fakeFirestore';
let db: CountingDb;
vi.mock('../../src/localdb/connection', () => ({ getDb: () => db, getCurrentUid: () => 'me' }));
vi.mock('firebase/firestore', () => firestoreMock);
vi.mock('firebase/firestore/lite', () => ({ ...firestoreMock, getFirestore: () => ({}) }));
vi.mock('../../src/lib/firebase', () => ({ app: {}, db: {}, auth: { currentUser: { uid: 'me' } } }));
import { pullMessages, pullMessageHistoryPage, pullMessageById, pullConversations, pullRecentMessages } from '../../src/localdb/sync/firebasePull';
import { applyRemoteMessages, listMessages } from '../../src/localdb/repositories/messagesRepo';
import { remoteMessageInput } from '../../src/localdb/sync/remoteMessage';
import { setCursor, getState, setState } from '../../src/localdb/repositories/syncStateRepo';
import { listConversations } from '../../src/localdb/repositories/conversationsRepo';
import { onLocalMessagesChanged } from '../../src/localdb/messageChanges';
const T = 1_700_000_000_000;
const data = (k: number) => ({ senderUid: 'peer', type: 'text', text: `message ${k}`, createdAt: fakeTs(T + k) });
beforeEach(async () => { db = await createSqlJsDb(); resetFake(); });
afterEach(() => { db.close(); vi.restoreAllMocks(); });

describe('server-owned paging cursors', () => {
  it('loads the newest 25 despite an old forward cursor and does not skip the middle gap', async () => {
    for (let k = 0; k < 1000; k++) fakeSeed(`conversations/c/messages/m${k}`, data(k));
    const cursor = JSON.stringify({ seconds: T / 1000, nanoseconds: 0, id: 'm0' });
    await setState('msg_cursor_v2:c', cursor);
    await pullRecentMessages('c');
    let rows = await listMessages('c', 1000);
    expect(rows).toHaveLength(25);
    expect(rows[0].remote_id).toBe('m999');
    expect(rows[24].remote_id).toBe('m975');
    expect(await getState('msg_cursor_v2:c')).toBe(cursor);
    expect(await getState('history_v2:c')).toBeNull();
    // The ordinary durable catch-up still repairs the missing middle.
    await pullMessages('c', 100, 10);
    rows = await listMessages('c', 1000);
    expect(rows).toHaveLength(999);
    expect(rows.some(r => r.remote_id === 'm500')).toBe(true);
  });

  it('a late bootstrap does not overwrite live edits or resurrect deleted content', async () => {
    fakeSeed('conversations/c/messages/edit', data(1));
    fakeSeed('conversations/c/messages/delete', data(2));
    await applyRemoteMessages([
      remoteMessageInput('edit', 'c', { ...data(1), text: 'new edit' }),
      remoteMessageInput('delete', 'c', { ...data(2), deletedForEveryone: true }),
    ]);
    await pullRecentMessages('c');
    const rows = await listMessages('c');
    expect(rows.find(r => r.remote_id === 'edit')?.text).toBe('new edit');
    expect(rows.find(r => r.remote_id === 'delete')).toMatchObject({ text: null, deleted_for_everyone: 1 });
  });

  it('repairs a middle gap despite legacy backfill_done and disconnected local windows', async () => {
    for (let k = 0; k < 1000; k++) fakeSeed(`conversations/c/messages/m${k}`, data(k));
    const cached = [...Array.from({ length: 50 }, (_, i) => i), ...Array.from({ length: 100 }, (_, i) => 900 + i)];
    await applyRemoteMessages(cached.map(k => remoteMessageInput(`m${k}`, 'c', data(k))));
    await setCursor('backfill_done:c', T); await setCursor('backfill_before:c', T);
    for (let page = 0; page < 11; page++) await pullMessageHistoryPage('c');
    const rows = await listMessages('c', 2000);
    expect(rows).toHaveLength(1000);
    expect(new Set(rows.map(r => r.remote_id)).size).toBe(1000);
    expect(JSON.parse((await getState('history_v2:c'))!).done).toBe(true);
  });
  it('makes progress through more than one page sharing the exact same timestamp in both directions', async () => {
    for (let k = 0; k < 237; k++) fakeSeed(`conversations/c/messages/m${String(k).padStart(4, '0')}`, data(0));
    await setCursor('msg_cursor:c', T);
    expect(await pullMessages('c', 50, 2)).toBe(100);
    expect(await pullMessages('c', 50, 2)).toBe(100);
    expect(await pullMessages('c', 50, 2)).toBe(37);
    expect(await pullMessages('c', 50, 2)).toBe(0);
    expect(await listMessages('c', 500)).toHaveLength(237);
    expect(await pullMessageHistoryPage('c', 100)).toBe(100);
    expect(await pullMessageHistoryPage('c', 100)).toBe(100);
    expect(await pullMessageHistoryPage('c', 100)).toBe(37);
    expect(await pullMessageHistoryPage('c', 100)).toBe(0);
  });
  it('opens an empty device on the newest page without traversing the oldest history', async () => {
    for (let k = 0; k < 1000; k++) fakeSeed(`conversations/c/messages/m${k}`, data(k));
    expect(await pullMessages('c')).toBe(50);
    const rows = await listMessages('c', 100);
    expect(rows).toHaveLength(50);
    expect(rows[0].remote_id).toBe('m999');
    expect(rows[49].remote_id).toBe('m950');
    fakeSeed('conversations/c/messages/new', data(1001));
    expect(await pullMessages('c')).toBe(1);
  });
  it('paginates conversation updates sharing one timestamp and preserves their summary fields', async () => {
    for (let k = 0; k < 123; k++) fakeSeed(`conversations/c${k}`, {
      type: 'group', name: `Group ${k}`, participantUids: ['me'], memberCount: 12,
      updatedAt: fakeTs(T), lastMessageAt: fakeTs(T - 5000), lastMessageText: 'summary',
    });
    await pullConversations();
    const rows = await listConversations();
    expect(rows).toHaveLength(123);
    expect(rows[0]).toMatchObject({ type: 'group', member_count: 12, last_message_preview: 'summary', last_message_at: T - 5000 });
    await pullConversations();
    expect(await listConversations()).toHaveLength(123);
  });
  it('does not advance its cursor if SQLite cannot commit, and succeeds on retry', async () => {
    fakeSeed('conversations/c/messages/m1', data(1));
    vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('disk busy'));
    await expect(pullMessages('c')).rejects.toThrow('disk busy');
    expect(await getState('msg_cursor_v2:c')).toBeNull();
    expect(await pullMessages('c')).toBe(1);
    expect(await listMessages('c')).toHaveLength(1);
  });
  it('respects clear-chat boundaries while rebuilding an old gap', async () => {
    for (let k = 0; k < 100; k++) fakeSeed(`conversations/c/messages/m${k}`, data(k));
    await setCursor('chat_cleared:c', T + 49);
    await pullMessageHistoryPage('c');
    expect(await listMessages('c', 100)).toHaveLength(50);
  });
  it('notifies the open screen only after the targeted message has committed', async () => {
    fakeSeed('conversations/c/messages/target', data(1));
    const reads: Array<Promise<any[]>> = [];
    const stop = onLocalMessagesChanged(c => { if (c === 'c') reads.push(listMessages(c)); });
    expect(await pullMessageById('c', 'target')).toBe(true);
    stop();
    expect(reads).toHaveLength(1);
    expect((await reads[0])[0].remote_id).toBe('target');
  });
});
