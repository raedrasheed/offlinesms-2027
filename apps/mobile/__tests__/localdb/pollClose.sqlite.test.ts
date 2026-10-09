import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqlJsDb, type CountingDb } from '../support/sqljsDb';

let db: CountingDb;
let uid: string | null = 'creator';
const remoteCall = vi.hoisted(() => vi.fn());
vi.mock('../../src/localdb/connection', () => ({ getDb: () => db, getCurrentUid: () => uid }));
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}),
  httpsCallable: (_functions: unknown, name: string) => async (data: unknown) => ({ data: await remoteCall(name, data) }),
}));
vi.mock('expo-file-system', () => ({}));
vi.mock('../../src/lib/firebase', () => ({ app: {}, auth: { currentUser: { uid: 'creator' } } }));
vi.mock('../../src/media/transferProgress', () => ({ setTransferProgress: vi.fn(), clearTransfer: vi.fn() }));

import * as messages from '../../src/localdb/repositories/messagesRepo';
import * as outbox from '../../src/localdb/repositories/outboxRepo';
import { enqueuePollClose } from '../../src/localdb/pollClose';
import { createMessageMapper } from '../../src/hooks/messageModel';
import { onLocalMessagesChanged } from '../../src/localdb/messageChanges';
import { sanitizePoll } from '../../src/lib/pollModel';
import type { OutboxRow } from '../../src/localdb/types';
import { pushOutboxItem } from '../../src/localdb/sync/firebasePush';

const args = { conversationId: 'chat', messageId: 'poll' };
const poll = () => sanitizePoll({ question: 'When?', options: [{ id: 'a', text: 'Today' }, { id: 'b', text: 'Tomorrow' }], votes: {} });
async function seed(extra: Partial<messages.RemoteMessageInput> = {}) {
  await messages.upsertRemoteMessage({ remoteId: 'poll', conversationId: 'chat', senderUid: 'creator',
    type: 'poll', text: 'When?', remoteCreatedAt: 100, payload: JSON.stringify(poll()), ...extra });
}
async function pending() { return db.all<OutboxRow>('SELECT * FROM outbox'); }
async function view() { return createMessageMapper()(await messages.listMessages('chat'))[0]?.poll; }

beforeEach(async () => { db = await createSqlJsDb(); uid = 'creator'; remoteCall.mockReset().mockResolvedValue({ ok: true }); });
afterEach(() => db.close());

describe('offline poll closing', () => {
  it('keeps conversation reads and poll status lookups indexed without a temporary sort', async () => {
    await seed(); await enqueuePollClose(args);
    const read = vi.spyOn(db, 'all');
    await messages.listMessages('chat');
    const [sql, params] = read.mock.calls[0];
    read.mockRestore();
    const plan = (await db.plan(sql, params)).join('\n');
    expect(plan).toMatch(/SEARCH messages USING INDEX/);
    expect(plan).toMatch(/SEARCH outbox USING INDEX/);
    expect(plan).not.toMatch(/SCAN outbox|TEMP B-TREE/);
  });

  it('persists one close request and exposes pending state without pretending the server closed it', async () => {
    await seed();
    const changed = vi.fn();
    const stop = onLocalMessagesChanged(changed);
    try {
      expect(await enqueuePollClose(args)).toEqual({ ok: true });
      const jobs = await pending();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ type: 'close_poll', status: 'pending', conversation_id: 'chat', entity_id: 'poll' });
      expect(JSON.parse(jobs[0].payload_json)).toEqual(args);
      expect(await view()).toMatchObject({ closed: false, closingPending: true, closingFailed: false });
      expect(changed).toHaveBeenCalledWith('chat');
      expect(remoteCall).not.toHaveBeenCalled();
    } finally { stop(); }
  });

  it('survives closing and reopening the actual SQLite database', async () => {
    await seed(); await enqueuePollClose(args);
    const data = db.raw.export(); db.close();
    db = await createSqlJsDb({ data, migrate: false });
    expect(await view()).toMatchObject({ closingPending: true });
    expect(await outbox.claimDue()).toHaveLength(1);
  });

  it('deduplicates repeated closes', async () => {
    await seed(); await enqueuePollClose(args); await enqueuePollClose(args);
    expect(await pending()).toHaveLength(1);
  });

  it('keeps pending state across an incoming open-poll snapshot while preserving new votes', async () => {
    await seed(); await enqueuePollClose(args);
    await seed({ payload: JSON.stringify(sanitizePoll({ ...poll(), votes: { voter: ['b'] } })) });
    expect(await view()).toMatchObject({ closed: false, closingPending: true, counts: { a: 0, b: 1 }, voterCount: 1 });
  });

  it('confirms closing without overwriting a vote that arrived during the request', async () => {
    await seed(); await enqueuePollClose(args);
    await seed({ payload: JSON.stringify(sanitizePoll({ ...poll(), votes: { voter: ['a'] } })) });
    await messages.confirmPollClosed('poll');
    await outbox.markCompleted((await pending())[0].id);
    expect(await view()).toMatchObject({ closed: true, closingPending: false, counts: { a: 1, b: 0 }, voterCount: 1 });
  });

  it('dispatches the stored close through the real outbox adapter and confirms it locally', async () => {
    await seed(); await enqueuePollClose(args);
    const item = (await pending())[0];
    await outbox.markProcessing(item.id);
    expect(await pushOutboxItem(item)).toEqual({ ok: true });
    expect(remoteCall).toHaveBeenCalledWith('closePoll', args);
    expect(await view()).toMatchObject({ closed: true, closingPending: false });
  });

  it('keeps the local poll open if the server rejects the close', async () => {
    await seed(); await enqueuePollClose(args);
    remoteCall.mockRejectedValue(Object.assign(new Error('not-a-participant'), { code: 'functions/permission-denied' }));
    await expect(pushOutboxItem((await pending())[0])).rejects.toThrow('not-a-participant');
    expect(await view()).toMatchObject({ closed: false });
  });

  it('can replay a close after a lost response without changing its votes', async () => {
    await seed({ payload: JSON.stringify(sanitizePoll({ ...poll(), votes: { voter: ['b'] } })) });
    await enqueuePollClose(args);
    const item = (await pending())[0];
    await pushOutboxItem(item);
    await pushOutboxItem(item);
    expect(await view()).toMatchObject({ closed: true, voterCount: 1, counts: { a: 0, b: 1 } });
    expect(await pending()).toHaveLength(1);
  });

  it('keeps a retryable network error queued', async () => {
    await seed(); await enqueuePollClose(args);
    await outbox.markFailed((await pending())[0].id, 'unavailable', 'offline', Date.now() + 1000);
    expect(await view()).toMatchObject({ closed: false, closingPending: true, closingFailed: false });
  });

  it('shows permanent refusal and allows an explicit retry without duplicating the action', async () => {
    await seed(); await enqueuePollClose(args);
    const item = (await pending())[0];
    await outbox.markFailed(item.id, 'permission-denied', 'removed', Date.now() + 1e12, true);
    expect(await view()).toMatchObject({ closed: false, closingPending: false, closingFailed: true });
    await enqueuePollClose(args);
    expect(await pending()).toHaveLength(1);
    expect((await pending())[0]).toMatchObject({ id: item.id, status: 'pending', attempt_count: 0, last_error_code: null });
    expect(await view()).toMatchObject({ closingPending: true, closingFailed: false });
  });

  it('invalidates only the poll bubble when the outbox changes', async () => {
    await seed();
    await seed({ remoteId: 'text', type: 'text', payload: null, remoteCreatedAt: 101 });
    const map = createMessageMapper();
    const before = map(await messages.listMessages('chat'));
    await enqueuePollClose(args);
    const after = map(await messages.listMessages('chat'));
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  it.each([
    ['not-initialised', () => { uid = null; }, args],
    ['only-creator-can-close', () => { uid = 'other'; }, args],
    ['not-delivered', () => {}, { ...args, conversationId: 'other-chat' }],
    ['not-delivered', () => {}, { ...args, messageId: 'missing' }],
  ] as const)('refuses %s before writing', async (reason, prepare, input) => {
    await seed(); prepare();
    expect(await enqueuePollClose(input)).toEqual({ ok: false, reason });
    expect(await pending()).toHaveLength(0);
  });

  it.each([{ type: 'text' as const }, { deletedForEveryone: true }, { payload: 'invalid JSON' }])('refuses an invalid/deleted poll', async extra => {
    await seed(extra);
    expect(await enqueuePollClose(args)).toEqual({ ok: false, reason: 'not-a-poll' });
    expect(await pending()).toHaveLength(0);
  });

  it('does not enqueue a poll already closed on the server', async () => {
    await seed({ payload: JSON.stringify({ ...poll(), closed: true }) });
    expect(await enqueuePollClose(args)).toEqual({ ok: true });
    expect(await pending()).toHaveLength(0);
  });

  it('notifies no detached screen', async () => {
    const changed = vi.fn();
    const stop = onLocalMessagesChanged(changed); stop();
    await seed(); await enqueuePollClose(args);
    expect(changed).not.toHaveBeenCalled();
  });
});
