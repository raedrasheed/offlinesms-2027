// Notification → visible message: the pure pieces (refresh coalescing, the
// targeted-fetch coordinator, banner selection, push routing with messageId,
// structural sharing of mapped messages, the single remote→local mapper).
import { describe, it, expect, vi } from 'vitest';
import { coalescing } from '../src/lib/coalesce';
import { createNotificationTargets, type TargetDeps } from '../src/localdb/sync/notificationTarget';
import { syncBannerKind } from '../src/components/chat/syncBannerModel';
import { routeFromNotification, dispatchForRoute, pushTarget } from '../src/lib/pushRouting';
import { createMessageMapper } from '../src/hooks/messageModel';
import { remoteMessageInput } from '../src/localdb/sync/remoteMessage';
import type { MessageRow } from '../src/localdb/types';

const tick = () => new Promise(r => setTimeout(r, 0));

describe('coalescing runner', () => {
  it('never drops a request made while a run is in flight', async () => {
    let data = 1;
    const seen: number[] = [];
    let release!: () => void;
    let calls = 0;
    const run = coalescing(async () => {
      calls++;
      const snapshot = data;
      if (calls === 1) await new Promise<void>(r => { release = r; });
      seen.push(snapshot);
    });
    const first = run();
    await tick();
    data = 2;            // a new message lands mid-refresh…
    const second = run(); // …and its refresh request must not be lost
    release();
    await Promise.all([first, second]);
    expect(seen).toEqual([1, 2]);
  });

  it('collapses a burst of requests into one extra pass', async () => {
    let calls = 0;
    let release!: () => void;
    const run = coalescing(async () => {
      calls++;
      if (calls === 1) await new Promise<void>(r => { release = r; });
    });
    const p = run();
    await tick();
    for (let i = 0; i < 10; i++) void run();
    release();
    await p;
    expect(calls).toBe(2);
  });

  it('survives a failing task and runs again on the next request', async () => {
    let n = 0;
    const run = coalescing(async () => { n++; if (n === 1) throw new Error('boom'); });
    await run();
    await run();
    expect(n).toBe(2);
  });
});

function deps(over: Partial<TargetDeps> = {}) {
  let connCb: ((online: boolean) => void) | null = null;
  const d: TargetDeps & { goOnline: () => void } = {
    isDbOpen: () => true,
    isOnline: () => true,
    hasLocal: async () => false,
    fetchOne: vi.fn(async () => true),
    onConnectivity: (cb) => { connCb = cb; return () => { connCb = null; }; },
    goOnline: () => connCb?.(true),
    ...over,
  };
  return d;
}

describe('notification targets', () => {
  it('reports ready without a read when the message is already local', async () => {
    const d = deps({ hasLocal: async () => true });
    const t = createNotificationTargets(d);
    expect(await t.request('c1', 'm1')).toBe('ready');
    expect(d.fetchOne).not.toHaveBeenCalled();
  });

  it('fetches exactly the one message and de-duplicates concurrent requests', async () => {
    const d = deps();
    const t = createNotificationTargets(d);
    const [a, b] = await Promise.all([t.request('c1', 'm1'), t.request('c1', 'm1')]);
    expect([a, b]).toEqual(['ready', 'ready']);
    expect(d.fetchOne).toHaveBeenCalledTimes(1);
    expect(d.fetchOne).toHaveBeenCalledWith('c1', 'm1');
  });

  it('queues a cold-start request until the local DB opens', async () => {
    let open = false;
    const d = deps({ isDbOpen: () => open });
    const t = createNotificationTargets(d);
    const states: string[] = [];
    t.subscribe((_c, _m, s) => states.push(s));
    expect(await t.request('c1', 'm1')).toBe('pending');
    expect(d.fetchOne).not.toHaveBeenCalled();
    open = true;
    t.onDbOpened();
    await tick(); await tick();
    expect(d.fetchOne).toHaveBeenCalledTimes(1);
    expect(t.state('c1', 'm1')).toBe('ready');
    expect(states).toEqual(['pending', 'fetching', 'ready']);
  });

  it('waits for the network and retries on reconnect', async () => {
    let online = false;
    const d = deps({ isOnline: () => online });
    const t = createNotificationTargets(d);
    expect(await t.request('c1', 'm1')).toBe('waiting-network');
    online = true;
    d.goOnline();
    await tick(); await tick();
    expect(t.state('c1', 'm1')).toBe('ready');
  });

  it('a read that fails while online is an error the user can retry', async () => {
    let fail = true;
    const d = deps({ fetchOne: vi.fn(async () => { if (fail) throw new Error('unavailable'); return true; }) });
    const t = createNotificationTargets(d);
    expect(await t.request('c1', 'm1')).toBe('error');
    fail = false;
    expect(await t.retry('c1', 'm1')).toBe('ready');
  });

  it('a read that fails because the connection dropped waits for the network', async () => {
    let online = true;
    const d = deps({ isOnline: () => online, fetchOne: vi.fn(async () => { online = false; throw new Error('offline'); }) });
    const t = createNotificationTargets(d);
    expect(await t.request('c1', 'm1')).toBe('waiting-network');
  });

  it('a deleted / inaccessible message is reported as missing', async () => {
    const t = createNotificationTargets(deps({ fetchOne: vi.fn(async () => false) }));
    expect(await t.request('c1', 'gone')).toBe('missing');
  });
});

describe('syncBannerKind', () => {
  const f = (state: any) => ({ messageId: 'm1', state });
  it('shows "loading this message" while the target is being located or fetched', () => {
    expect(syncBannerKind(f('locating'), 'live', false)).toBe('loading-message');
    expect(syncBannerKind(f('fetching'), 'connecting', false)).toBe('loading-message');
    expect(syncBannerKind(f('pending'), 'live', false)).toBe('loading-message');
  });
  it('shows "waiting for connection" when the target cannot be fetched offline', () => {
    expect(syncBannerKind(f('fetching'), 'offline', false)).toBe('waiting-network');
    expect(syncBannerKind(f('waiting-network'), 'live', false)).toBe('waiting-network');
  });
  it('reports missing / error targets', () => {
    expect(syncBannerKind(f('missing'), 'live', false)).toBe('missing');
    expect(syncBannerKind(f('error'), 'live', false)).toBe('error');
  });
  it('falls back to connection state once the target is shown', () => {
    expect(syncBannerKind(f('ready'), 'live', false)).toBeNull();
    expect(syncBannerKind(f('ready'), 'offline', false)).toBe('offline');
  });
  it('does not flash "connecting" during a fast open', () => {
    expect(syncBannerKind(null, 'connecting', false)).toBeNull();
    expect(syncBannerKind(null, 'connecting', true)).toBe('connecting');
  });
});

describe('push routing keeps the message id', () => {
  const data = { type: 'chat_message', conversationId: 'c1', messageId: 'm1', route: 'Conversation' };
  it('routes a tap to the conversation AND the message', () => {
    expect(dispatchForRoute(routeFromNotification(data)))
      .toEqual({ kind: 'screen', name: 'Conversation', params: { id: 'c1', messageId: 'm1' } });
  });
  it('pushTarget names what to prefetch', () => {
    expect(pushTarget(routeFromNotification(data))).toEqual({ conversationId: 'c1', messageId: 'm1' });
    expect(pushTarget(routeFromNotification({ type: 'admin_broadcast', broadcastId: 'b', actionType: 'open_chat', actionTarget: 'c9' })))
      .toEqual({ conversationId: 'c9' });
    expect(pushTarget(routeFromNotification({ type: 'admin_broadcast', broadcastId: 'b', actionType: 'open_url', actionTarget: 'https://x' })))
      .toBeNull();
    expect(pushTarget(null)).toBeNull();
  });
});

function row(p: Partial<MessageRow>): MessageRow {
  return {
    id: 'm1', local_id: null, remote_id: null, conversation_id: 'c1',
    sender_uid: 'u1', sender_display_name: null, type: 'text', text: 'hi',
    preview: 'hi', created_at: 1000, remote_created_at: null, updated_at: 1000,
    edited_at: null, deleted_for_everyone: 0, deleted_for_me: 0, deleted_at: null,
    reply_to_message_id: null, reply_to_preview: null, forwarded: 0,
    forwarded_from_message_id: null, status: 'sent', error_code: null,
    error_message: null, sync_status: 'synced', client_sequence: 0, server_version: 0,
    reactions_json: null, delivered_count: 0, read_count: 0, viewed_count: 0, played_count: 0,
    ...p,
  };
}

describe('createMessageMapper (structural sharing)', () => {
  const rows = Array.from({ length: 5 }, (_, i) => row({ id: `r${i}`, remote_id: `r${i}`, remote_created_at: 1000 + i, reactions_json: i === 2 ? '{"👍":["u2"]}' : null }));

  it('reuses unchanged Message objects so only new/changed bubbles re-render', () => {
    const map = createMessageMapper();
    const a = map(rows);
    const b = map([row({ id: 'r9', remote_id: 'r9', remote_created_at: 2000 }), ...rows]);
    const prev = new Map(a.map(m => [m.id, m]));
    expect(b.filter(m => prev.get(m.id) !== m).map(m => m.id)).toEqual(['r9']);
  });

  it('produces a new object when a row changes (reaction, read count, edit)', () => {
    const map = createMessageMapper();
    const a = map(rows);
    const changed = rows.map(r => r.id === 'r1' ? { ...r, read_count: 1 } : r.id === 'r3' ? { ...r, text: 'edited', edited_at: 5 } : r);
    const b = map(changed);
    const prev = new Map(a.map(m => [m.id, m]));
    expect(b.filter(m => prev.get(m.id) !== m).map(m => m.id).sort()).toEqual(['r1', 'r3']);
  });

  it('orders by server time with stable tie-breaks', () => {
    const map = createMessageMapper();
    const out = map([
      row({ id: 'b', remote_id: 'b', remote_created_at: 10, created_at: 1 }),
      row({ id: 'a', remote_id: 'a', remote_created_at: 10, created_at: 1 }),
      row({ id: 'p', local_id: 'p', remote_created_at: null, created_at: 5 }),
    ]);
    expect(out.map(m => m.id)).toEqual(['p', 'a', 'b']);
  });
});

describe('remoteMessageInput', () => {
  it('keeps type, caption and media (history pages used to drop them)', () => {
    const r = remoteMessageInput('m1', 'c1', {
      senderUid: 'u1', type: 'image', caption: 'look', text: null,
      createdAt: { toMillis: () => 42 },
      media: { mimeType: 'image/jpeg', width: 10, height: 20, storagePath: 'p', downloadURL: 'https://d' },
      deliveredCount: 2, readCount: 1, clientLocalId: 'local_msg_1',
    });
    expect(r).toMatchObject({
      remoteId: 'm1', conversationId: 'c1', type: 'image', caption: 'look', remoteCreatedAt: 42,
      counts: { delivered: 2, read: 1, viewed: 0, played: 0 }, clientLocalId: 'local_msg_1', status: 'sent',
    });
    expect(r.media).toMatchObject({ mimeType: 'image/jpeg', width: 10, height: 20, downloadURL: 'https://d' });
  });
  it('maps unknown types to text and missing optional fields to null', () => {
    const r = remoteMessageInput('m2', 'c1', { senderUid: 'u1', type: 'weird', text: 'x' });
    expect(r.type).toBe('text');
    expect(r.media).toBeNull();
    expect(r.remoteCreatedAt).toBeNull();
    expect(r.clientLocalId).toBeNull();
  });
});
