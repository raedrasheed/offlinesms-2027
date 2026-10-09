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
import { pushOutboxItem } from '../../src/localdb/sync/firebasePush';
import { retryQueuedSend } from '../../src/localdb/retrySend';
import { createMessageMapper } from '../../src/hooks/messageModel';
import { sanitizePoll } from '../../src/lib/pollModel';
import { onLocalMessagesChanged } from '../../src/localdb/messageChanges';

const draft = { question: 'Tea or coffee?', options: ['Tea', 'Coffee'], multiple: false };
const poll = sanitizePoll({ ...draft, options: [{ id: 'o1', text: 'Tea' }, { id: 'o2', text: 'Coffee' }] });
async function queued(kind: 'text' | 'sticker' | 'poll' = 'poll') {
  const row = await messages.insertLocalMessage({ conversationId: 'chat', senderUid: 'creator',
    text: kind === 'poll' ? '📊 Tea or coffee?' : kind === 'sticker' ? '👋' : 'Hello',
    type: kind, payloadJson: kind === 'poll' ? JSON.stringify(poll) : null, deviceId: 'device', clientSequence: 1 });
  const job = await outbox.enqueue({ type: 'send_message', entityType: 'message', entityId: row.local_id,
    conversationId: 'chat', idempotencyKey: `send:${row.local_id}`, payload: {
      kind, localId: row.local_id, conversationId: 'chat', text: row.text,
      ...(kind === 'poll' ? { poll: draft } : kind === 'sticker' ? { sticker: { packId: 'simsim', stickerId: 'wave' } } : {}),
    } });
  return { row, job };
}
beforeEach(async () => { db = await createSqlJsDb(); uid = 'creator'; remoteCall.mockReset().mockResolvedValue({ messageId: 'server-poll' }); });
afterEach(() => db.close());

describe('rich send preserves poll options', () => {
  it('an old text-only server refuses the request instead of publishing a poll icon as text', async () => {
    const { row, job } = await queued();
    const published: unknown[] = [];
    remoteCall.mockImplementation(async (_name, data) => {
      if (typeof data.text !== 'string') throw Object.assign(new Error('text-required'), { code: 'functions/invalid-argument' });
      published.push(data); return { messageId: 'plain-text' };
    });
    await expect(pushOutboxItem(job)).rejects.toThrow('text-required');
    expect(published).toEqual([]);
    await messages.setError(row.local_id!, 'invalid-argument', 'text-required');
    const model = createMessageMapper()(await messages.listMessages('chat'))[0];
    expect(model).toMatchObject({ type: 'poll', status: 'failed', poll: { question: draft.question, options: poll.options } });
  });

  it('sends the structured question/options and preserves the card after acknowledgement', async () => {
    const { row, job } = await queued();
    expect(await pushOutboxItem(job)).toMatchObject({ ok: true, remoteId: 'server-poll' });
    const [name, request] = remoteCall.mock.calls[0];
    expect(name).toBe('sendTextMessage');
    expect(request).toMatchObject({ kind: 'poll', poll: draft, localId: row.local_id, idempotencyKey: job.idempotency_key });
    expect(request).not.toHaveProperty('text');
    await messages.reconcileToRemote(row.local_id!, { remoteId: 'server-poll', remoteCreatedAt: null });
    expect(createMessageMapper()(await messages.listMessages('chat'))[0]).toMatchObject({ type: 'poll', status: 'sent', poll: { question: draft.question, options: poll.options } });
  });

  it('also prevents silent sticker-to-text conversion', async () => {
    await pushOutboxItem((await queued('sticker')).job);
    expect(remoteCall.mock.calls[0][1]).toMatchObject({ kind: 'sticker', sticker: { packId: 'simsim', stickerId: 'wave' } });
    expect(remoteCall.mock.calls[0][1]).not.toHaveProperty('text');
  });

  it('keeps normal text delivery unchanged', async () => {
    await pushOutboxItem((await queued('text')).job);
    expect(remoteCall.mock.calls[0][1].text).toBe('Hello');
  });

  it('retries a rejected poll after app restart with the same job/key and full options', async () => {
    const { row, job } = await queued();
    await messages.setError(row.local_id!, 'invalid-argument', 'text-required');
    await outbox.markFailed(job.id, 'invalid-argument', 'text-required', Date.now() + 1e12);
    const saved = db.raw.export(); db.close(); db = await createSqlJsDb({ data: saved, migrate: false });
    const changed = vi.fn(); const stop = onLocalMessagesChanged(changed);
    try {
      expect(await retryQueuedSend(row.local_id!)).toBe(true);
      expect(await outbox.claimDue()).toMatchObject([{ id: job.id, idempotency_key: job.idempotency_key, status: 'pending', attempt_count: 0 }]);
      expect(createMessageMapper()(await messages.listMessages('chat'))[0]).toMatchObject({ type: 'poll', status: 'sending', errorCode: null, poll: { options: poll.options } });
      expect(changed).toHaveBeenCalledWith('chat');
      expect(await retryQueuedSend(row.local_id!)).toBe(false);
      expect(await db.all('SELECT id FROM outbox')).toHaveLength(1);
    } finally { stop(); }
  });

  it('does not resend a delivered poll or another account’s draft', async () => {
    const { row } = await queued();
    await messages.setError(row.local_id!, 'unavailable', 'offline');
    uid = 'other'; expect(await retryQueuedSend(row.local_id!)).toBe(false);
    uid = 'creator'; await messages.reconcileToRemote(row.local_id!, { remoteId: 'sent', remoteCreatedAt: 1 });
    expect(await retryQueuedSend(row.local_id!)).toBe(false);
    uid = null; expect(await retryQueuedSend(row.local_id!)).toBe(false);
  });
});
