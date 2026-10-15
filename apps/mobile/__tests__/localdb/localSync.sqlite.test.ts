// Real-SQLite (sql.js) tests for the notification → visible-message path: the
// realtime feeder applies only changed docs and notifies after commit, the
// targeted single-message fetch, duplicate-free applies (including our own
// message arriving before the send call returns), order, read counts, and the
// v6 read-path indexes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSqlJsDb, type CountingDb } from '../support/sqljsDb';
import { firestoreMock, fakeSeed, fakeWrite, fakeTs, resetFake } from '../support/fakeFirestore';

(globalThis as any).__DEV__ = false;

let db: CountingDb;
vi.mock('../../src/localdb/connection', () => ({ getDb: () => db, getCurrentUid: () => 'u_me' }));
vi.mock('firebase/firestore', () => firestoreMock);
vi.mock('firebase/firestore/lite', () => ({ ...firestoreMock, getFirestore: () => ({}) }));
vi.mock('../../src/lib/firebase', () => ({ app: {}, db: {}, auth: { currentUser: { uid: 'u_me' } } }));

import * as messagesRepo from '../../src/localdb/repositories/messagesRepo';
import { startConversationFeeder, type FeederChange } from '../../src/localdb/sync/conversationFeeder';
import { pullMessageById } from '../../src/localdb/sync/firebasePull';
import { remoteMessageInput } from '../../src/localdb/sync/remoteMessage';
import { mapAndOrderMessages } from '../../src/hooks/messageModel';

const C = 'c1';
const T = 1_700_000_000_000;
const msg = (k: number, extra: Record<string, any> = {}) => ({
  senderUid: k % 2 ? 'u_me' : 'u_peer', type: 'text', text: `m${k}`,
  createdAt: fakeTs(T + k * 1000), deliveredCount: 0, readCount: 0, ...extra,
});
const flush = () => new Promise(r => setTimeout(r, 0));

async function visibleIds(): Promise<string[]> {
  return mapAndOrderMessages(await messagesRepo.listMessages(C, 500)).map(m => m.id);
}

beforeEach(async () => { db = await createSqlJsDb(); resetFake(); });
afterEach(() => db.close());

describe('conversation feeder', () => {
  it('publishes the newest chunk before writing the rest of the initial 100-message window', async () => {
    for (let k = 0; k < 100; k++) fakeSeed(`conversations/${C}/messages/m${k}`, msg(k));
    const sizes: number[] = [];
    const initialNewest: string[] = [];
    const stop = startConversationFeeder(C, ch => {
      sizes.push(ch.ids.length);
      if (!initialNewest.length) initialNewest.push(...ch.ids);
    });
    await vi.waitFor(() => expect(sizes.reduce((a, b) => a + b, 0)).toBe(100));
    expect(sizes).toEqual([20, 20, 20, 20, 20]);
    expect(initialNewest[0]).toBe('m99');
    expect(initialNewest).not.toContain('m0');
    expect(await visibleIds()).toHaveLength(100);
    stop();
  });

  it('retries a rejected local write without waiting for another server snapshot', async () => {
    vi.useFakeTimers();
    fakeSeed(`conversations/${C}/messages/retry`, msg(1));
    const write = vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('database busy'));
    const onChange = vi.fn(); const onError = vi.fn();
    const stop = startConversationFeeder(C, onChange, onError);
    try {
      await vi.advanceTimersByTimeAsync(600);
      expect(await visibleIds()).toEqual(['retry']);
      expect(write).toHaveBeenCalledTimes(2);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
    } finally { stop(); write.mockRestore(); vi.useRealTimers(); }
  });

  it('does not apply a snapshot queued before the screen was closed', async () => {
    fakeSeed(`conversations/${C}/messages/late`, msg(1));
    const onChange = vi.fn();
    const stop = startConversationFeeder(C, onChange);
    stop(); await flush();
    expect(await visibleIds()).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stores the first window, then applies only the changed doc and notifies after commit', async () => {
    for (let k = 0; k < 5; k++) fakeSeed(`conversations/${C}/messages/m${k}`, msg(k));
    const changes: FeederChange[] = [];
    const seenAtNotify: string[][] = [];
    const stop = startConversationFeeder(C, (ch) => {
      changes.push(ch);
      // The re-read inside onChange must already see the write.
      void messagesRepo.listMessages(C, 500).then(r => seenAtNotify.push(r.map(x => x.remote_id!)));
    });
    await flush(); await flush();
    expect(changes[0].ids.sort()).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);

    db.resetCount();
    fakeWrite(`conversations/${C}/messages/m5`, msg(5));
    await flush(); await flush();
    expect(changes[1].ids).toEqual(['m5']);
    // One doc applied: a lookup + an insert (+ transaction), not the 5-doc window.
    expect(db.statements).toBeLessThanOrEqual(4);
    expect(seenAtNotify[1]).toContain('m5');
    expect(await visibleIds()).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5']);
    stop();
  });

  it('a doc leaving the window is not deleted locally; a delete-for-everyone keeps order but drops content', async () => {
    const stop = startConversationFeeder(C, () => {});
    for (let k = 0; k < 3; k++) fakeWrite(`conversations/${C}/messages/m${k}`, msg(k, { media: k === 1 ? { mimeType: 'image/jpeg', downloadURL: 'https://x' } : null, type: k === 1 ? 'image' : 'text' }));
    await flush(); await flush();
    fakeWrite(`conversations/${C}/messages/m1`, msg(1, { type: 'image', deletedForEveryone: true, text: 'secret' }));
    await flush(); await flush();
    const row = await messagesRepo.getByRemoteId('m1');
    expect(row?.deleted_for_everyone).toBe(1);
    expect(row?.text).toBeNull();
    expect((row as any)?.media_download_url ?? null).toBeNull();
    expect(await visibleIds()).toEqual(['m0', 'm1', 'm2']);
    stop();
  });

  it('read/delivered counts update in place without duplicating the message', async () => {
    const stop = startConversationFeeder(C, () => {});
    fakeWrite(`conversations/${C}/messages/m1`, msg(1));
    await flush(); await flush();
    fakeWrite(`conversations/${C}/messages/m1`, msg(1, { deliveredCount: 1, readCount: 1 }));
    await flush(); await flush();
    const rows = await messagesRepo.listMessages(C, 500);
    expect(rows).toHaveLength(1);
    expect(rows[0].read_count).toBe(1);
    expect(rows[0].delivered_count).toBe(1);
    stop();
  });

  it('stops notifying after unsubscribe', async () => {
    const onChange = vi.fn();
    const stop = startConversationFeeder(C, onChange);
    await flush();
    stop();
    fakeWrite(`conversations/${C}/messages/m9`, msg(9));
    await flush(); await flush();
    expect(onChange).toHaveBeenCalledTimes(1); // only the initial (empty) snapshot
  });
});

describe('duplicate-free applies', () => {
  it('the same message from feeder, catch-up pull and notification fetch is stored once', async () => {
    fakeSeed(`conversations/${C}/messages/m7`, msg(7));
    const stop = startConversationFeeder(C, () => {});
    await flush(); await flush();
    await messagesRepo.applyRemoteMessages([remoteMessageInput('m7', C, msg(7))]);
    expect(await pullMessageById(C, 'm7')).toBe(true);
    expect(await visibleIds()).toEqual(['m7']);
    stop();
  });

  it('our own message delivered by the feed before the send returns adopts the optimistic row', async () => {
    const local = await messagesRepo.insertLocalMessage({ conversationId: C, senderUid: 'u_me', text: 'hello', deviceId: 'dev', clientSequence: 1 });
    await messagesRepo.applyRemoteMessages([remoteMessageInput('srv1', C, { ...msg(1), text: 'hello', clientLocalId: local.local_id })]);
    let rows = await messagesRepo.listMessages(C, 500);
    expect(rows).toHaveLength(1);
    expect(rows[0].local_id).toBe(local.local_id);
    expect(rows[0].remote_id).toBe('srv1');
    expect(rows[0].status).toBe('sent');
    // The send call then returns and the outbox reconciles: still one row.
    await messagesRepo.reconcileToRemote(local.local_id!, { remoteId: 'srv1', remoteCreatedAt: null });
    rows = await messagesRepo.listMessages(C, 500);
    expect(rows).toHaveLength(1);
  });

  it('a clientLocalId never adopts a row in another conversation or one already synced', async () => {
    const other = await messagesRepo.insertLocalMessage({ conversationId: 'c2', senderUid: 'u_me', text: 'x', deviceId: 'dev', clientSequence: 1 });
    await messagesRepo.applyRemoteMessages([remoteMessageInput('srv2', C, { ...msg(2), clientLocalId: other.local_id })]);
    expect((await messagesRepo.getByLocalId(other.local_id!))?.remote_id).toBeNull();
    expect(await messagesRepo.listMessages(C, 500)).toHaveLength(1);
  });

  it('a batch is all-or-nothing', async () => {
    const bad = { ...remoteMessageInput('b2', C, msg(2)), conversationId: null as any };
    await expect(messagesRepo.applyRemoteMessages([remoteMessageInput('b1', C, msg(1)), bad])).rejects.toBeTruthy();
    expect(await messagesRepo.getByRemoteId('b1')).toBeNull();
  });
});

describe('targeted fetch and focus position', () => {
  it('pullMessageById stores exactly that message; a missing doc reports false', async () => {
    fakeSeed(`conversations/${C}/messages/target`, msg(3, { text: 'from push' }));
    expect(await pullMessageById(C, 'target')).toBe(true);
    expect((await messagesRepo.getByRemoteId('target'))?.text).toBe('from push');
    expect(await pullMessageById(C, 'nope')).toBe(false);
  });

  it('positionFromNewest tells how far back a focused message is', async () => {
    await messagesRepo.applyRemoteMessages(Array.from({ length: 50 }, (_, k) => remoteMessageInput(`p${k}`, C, msg(k))));
    expect(await messagesRepo.positionFromNewest(C, 'p49')).toBe(1);
    expect(await messagesRepo.positionFromNewest(C, 'p0')).toBe(50);
    expect(await messagesRepo.positionFromNewest(C, 'unknown')).toBeNull();
  });
});

describe('v6 read-path indexes', () => {
  it('conversation open and chat list read without a temporary sort', async () => {
    const m = await db.plan(`SELECT * FROM messages WHERE conversation_id = ? AND deleted_for_me = 0 ORDER BY COALESCE(remote_created_at, created_at) DESC LIMIT ?`, [C, 100]);
    expect(m.join(' ')).toContain('idx_messages_conv_visible_order');
    expect(m.join(' ')).not.toContain('TEMP B-TREE');
    const c = await db.plan(`SELECT * FROM conversations WHERE archived = 0 ORDER BY last_message_at DESC NULLS LAST`);
    expect(c.join(' ')).toContain('idx_conversations_archived_last');
    expect(c.join(' ')).not.toContain('TEMP B-TREE');
  });
});

describe('sticker and poll messages (v7 payload)', () => {
  const poll = (votes: Record<string, string[]>) => ({
    question: 'Lunch?', multiple: false, closed: false,
    options: [{ id: 'o1', text: 'Pizza' }, { id: 'o2', text: 'Falafel' }], votes, counts: {}, voterCount: 0,
  });

  it('live vote updates reach the open conversation as a new poll object (only that bubble re-renders)', async () => {
    const { createMessageMapper } = await import('../../src/hooks/messageModel');
    const map = createMessageMapper();
    const stop = startConversationFeeder(C, () => {});
    fakeWrite(`conversations/${C}/messages/p1`, msg(1, { type: 'poll', text: '📊 Lunch?', poll: poll({}) }));
    fakeWrite(`conversations/${C}/messages/t2`, msg(2));
    await flush(); await flush();
    const before = map(await messagesRepo.listMessages(C, 50));
    expect(before.find(m => m.id === 'p1')?.poll?.voterCount).toBe(0);

    fakeWrite(`conversations/${C}/messages/p1`, msg(1, { type: 'poll', text: '📊 Lunch?', poll: poll({ u_peer: ['o2'] }) }));
    await flush(); await flush();
    const after = map(await messagesRepo.listMessages(C, 50));
    const p = after.find(m => m.id === 'p1')!;
    expect(p.type).toBe('poll');
    expect(p.poll).toMatchObject({ voterCount: 1, counts: { o1: 0, o2: 1 } });
    expect(after.find(m => m.id === 't2')).toBe(before.find(m => m.id === 't2'));
    expect(p).not.toBe(before.find(m => m.id === 'p1'));
    stop();
  });

  it('stickers round-trip; delete-for-everyone drops the payload', async () => {
    const stop = startConversationFeeder(C, () => {});
    fakeWrite(`conversations/${C}/messages/s1`, msg(1, { type: 'sticker', text: '👋', sticker: { packId: 'simsim', stickerId: 'hi', alt: '👋' } }));
    await flush(); await flush();
    let rows = mapAndOrderMessages(await messagesRepo.listMessages(C, 50));
    expect(rows[0]).toMatchObject({ type: 'sticker', sticker: { packId: 'simsim', stickerId: 'hi' } });
    fakeWrite(`conversations/${C}/messages/s1`, msg(1, { type: 'sticker', text: '', deletedForEveryone: true }));
    await flush(); await flush();
    rows = mapAndOrderMessages(await messagesRepo.listMessages(C, 50));
    expect(rows[0].deletedForEveryone).toBe(true);
    expect(rows[0].sticker).toBeNull();
    expect((await messagesRepo.getByRemoteId('s1'))?.payload_json).toBeNull();
    stop();
  });

  it('an optimistic local vote is stored in the payload and replaced by the server tally', async () => {
    await messagesRepo.applyRemoteMessages([remoteMessageInput('p9', C, msg(1, { type: 'poll', poll: poll({}) }))]);
    const { applyLocalVote, parsePoll } = await import('../../src/lib/pollModel');
    const local = applyLocalVote(parsePoll(await messagesRepo.getPayload('p9'))!, 'u_me', ['o1']);
    await messagesRepo.setPayload('p9', JSON.stringify(local));
    expect(parsePoll(await messagesRepo.getPayload('p9'))?.votes).toEqual({ u_me: ['o1'] });
    await messagesRepo.applyRemoteMessages([remoteMessageInput('p9', C, msg(1, { type: 'poll', poll: poll({ u_me: ['o1'], u_peer: ['o1'] }) }))]);
    expect(parsePoll(await messagesRepo.getPayload('p9'))).toMatchObject({ voterCount: 2, counts: { o1: 2, o2: 0 } });
  });
});
