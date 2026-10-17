import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqlJsDb, type CountingDb } from '../support/sqljsDb';
let db: CountingDb;
let uid: string | null = 'alice';
const remoteCall = vi.hoisted(() => vi.fn());
vi.mock('../../src/localdb/connection', () => ({ getDb: () => db, getCurrentUid: () => uid }));
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}),
  httpsCallable: (_: unknown, name: string) => async (data: unknown) => ({ data: await remoteCall(name, data) }),
}));
vi.mock('expo-file-system', () => ({}));
vi.mock('../../src/lib/firebase', () => ({ app: {}, auth: { currentUser: { uid: 'alice' } } }));
vi.mock('../../src/media/transferProgress', () => ({ setTransferProgress: vi.fn(), clearTransfer: vi.fn() }));
import { enqueuePollVote, readOwnPollVote, saveOwnPollVote } from '../../src/localdb/pollVote';
import * as messages from '../../src/localdb/repositories/messagesRepo';
import * as outbox from '../../src/localdb/repositories/outboxRepo';
import { pushOutboxItem } from '../../src/localdb/sync/firebasePush';
import { sanitizePoll, payloadFromRemote, applyLocalVote } from '../../src/lib/pollModel';
import type { OutboxRow } from '../../src/localdb/types';

const args = { conversationId: 'chat', messageId: 'poll', uid: 'alice', optionIds: ['o1'] };
const poll = () => sanitizePoll({ question: 'When?', anonymous: true, multiple: true,
  options: [{ id: 'o1', text: 'Today' }, { id: 'o2', text: 'Tomorrow' }], counts: { o1: 2, o2: 1 }, voterCount: 2 });
async function seed() { await messages.upsertRemoteMessage({ remoteId: 'poll', conversationId: 'chat', senderUid: 'creator', text: 'When?', type: 'poll', remoteCreatedAt: 100, payload: JSON.stringify(poll()) }); }
const own = () => readOwnPollVote(db, 'chat', 'poll');
const confirm = (selection: string[], seq = 10) => saveOwnPollVote(db, 'chat', 'poll', selection, seq);
const jobs = () => db.all<OutboxRow>("SELECT * FROM outbox ORDER BY CAST(json_extract(payload_json, '$.seq') AS INTEGER)");
beforeEach(async () => { db = await createSqlJsDb(); uid = 'alice'; remoteCall.mockReset(); await seed(); });
afterEach(() => db.close());

describe('anonymous votes on real SQLite', () => {
  it('uses server aggregates and discards any identities or private fields in a remote payload', () => {
    const remote = { ...poll(), votes: { alice: ['o1'] }, mySelection: ['o1'] };
    const payload = JSON.parse(payloadFromRemote('poll', { poll: remote })!);
    expect(payload).toMatchObject({ anonymous: true, votes: {}, counts: { o1: 2, o2: 1 }, voterCount: 2 });
    expect(JSON.stringify(payload)).not.toContain('alice');
    expect(payload).not.toHaveProperty('mySelection');
    expect(applyLocalVote(payload, 'alice', ['o2'])).toBe(payload);
  });
  it('decodes the legacy-server privacy guard and preserves the actual anonymous close state', async () => {
    const wire = { ...poll(), closed: true, votingClosed: false };
    expect(sanitizePoll(wire)).toMatchObject({ closed: false, votingClosed: false });
    await messages.confirmPollClosed('poll');
    const stored = JSON.parse((await messages.getByRemoteId('poll'))!.payload_json!);
    expect(sanitizePoll(stored)).toMatchObject({ closed: true, votingClosed: true });
  });
  it('refuses an unknown private ballot before allowing multi-choice changes', async () => {
    expect(await enqueuePollVote(args)).toEqual({ ok: false, reason: 'vote-not-ready' });
    expect(await jobs()).toHaveLength(0);
  });
  it('keeps pending choices through remote updates, app restart, and separate accounts', async () => {
    await confirm([]); await enqueuePollVote(args); await seed();
    expect(await own()).toMatchObject({ known: true, selection: ['o1'], pending: true });
    expect(JSON.parse((await messages.getByRemoteId('poll'))!.payload_json!)).toEqual(poll());
    const data = db.raw.export(); db.close(); db = await createSqlJsDb({ data, migrate: false });
    expect(await own()).toMatchObject({ selection: ['o1'], pending: true });
    const aliceDb = db; db = await createSqlJsDb(); uid = 'bob';
    expect(await own()).toMatchObject({ known: false, selection: [] });
    expect(await enqueuePollVote(args)).toEqual({ ok: false, reason: 'not-initialised' });
    aliceDb.close();
  });
  it('preserves the newest rapid change, even if a retry ACK arrives later', async () => {
    await confirm([]);
    await Promise.all([enqueuePollVote(args), enqueuePollVote({ ...args, optionIds: ['o1', 'o2'] })]);
    const [first, second] = await jobs();
    const a = JSON.parse(first.payload_json), b = JSON.parse(second.payload_json);
    expect(b.seq).toBeGreaterThan(a.seq);
    await confirm(b.optionIds, b.seq); await confirm(a.optionIds, a.seq);
    expect(await own()).toMatchObject({ selection: ['o1', 'o2'], pending: false });
  });
  it('queues offline changes and restores confirmed selection after permanent failure', async () => {
    await confirm(['o2']); await enqueuePollVote(args);
    const item = (await jobs())[0];
    await outbox.markFailed(item.id, 'unavailable', 'offline', Date.now() + 100);
    expect(await own()).toMatchObject({ selection: ['o1'], pending: true, failed: false });
    await outbox.markFailed(item.id, 'permission-denied', 'removed', 0, true);
    expect(await own()).toMatchObject({ selection: ['o2'], pending: false, failed: true });
    await enqueuePollVote(args);
    expect(await own()).toMatchObject({ selection: ['o1'], pending: true, failed: false });
  });
  it('dispatches privately and caches the server-accepted selection, including a stale response', async () => {
    await confirm([]); await enqueuePollVote(args);
    const item = (await jobs())[0], seq = JSON.parse(item.payload_json).seq;
    remoteCall.mockResolvedValue({ ok: true, stale: true, selection: ['o2'], seq: seq + 1 });
    await pushOutboxItem(item); await outbox.markCompleted(item.id);
    expect(remoteCall).toHaveBeenCalledWith('votePoll', { conversationId: 'chat', messageId: 'poll', optionIds: ['o1'], seq });
    expect(await own()).toMatchObject({ selection: ['o2'], pending: false, failed: false });
    expect(JSON.parse((await messages.getByRemoteId('poll'))!.payload_json!)).toEqual(poll());
  });
  it('never writes a late response into a newly signed-in account', async () => {
    await confirm([]); await enqueuePollVote(args);
    const item = (await jobs())[0], aliceDb = db;
    remoteCall.mockImplementation(async () => {
      uid = 'bob'; db = await createSqlJsDb();
      return { ok: true, selection: ['o1'], seq: JSON.parse(item.payload_json).seq };
    });
    await pushOutboxItem(item);
    expect(await own()).toMatchObject({ known: false });
    aliceDb.close();
  });
  it('uses sendPollMessage for anonymous sends and never retries via the legacy endpoint', async () => {
    const item = await outbox.enqueue({ type: 'send_message', idempotencyKey: 'send-private', payload: {
      kind: 'poll', poll: { question: 'q', options: ['yes', 'no'], anonymous: true }, conversationId: 'chat', localId: 'local',
    } });
    remoteCall.mockRejectedValue(new Error('not-found'));
    await expect(pushOutboxItem(item)).rejects.toThrow('not-found');
    expect(remoteCall).toHaveBeenCalledOnce(); expect(remoteCall.mock.calls[0][0]).toBe('sendPollMessage');
  });
});
