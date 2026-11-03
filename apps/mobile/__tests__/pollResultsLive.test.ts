import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const state = vi.hoisted(() => ({ uid: 'me', listens: [] as any[], write: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: (_: unknown, ...path: string[]) => path.join('/'),
  onSnapshot: (path: string, _options: unknown, next: any, error: any) => {
    const stop = vi.fn(); state.listens.push({ path, next, error, stop }); return stop;
  },
}));
vi.mock('../src/lib/firebase', () => ({ db: {}, auth: { get currentUser() { return { uid: state.uid }; } } }));
vi.mock('../src/localdb/connection', () => ({ getCurrentUid: () => state.uid, getDb: () => database }));
vi.mock('../src/localdb/repositories/messagesRepo', () => ({ applyRemoteMessages: state.write }));
import { usePollResults } from '../src/hooks/usePollResults';
import { sanitizePoll } from '../src/lib/pollModel';
const database = {};
const cached = sanitizePoll({ question: 'Old poll', options: [{ id: 'o1', text: 'Yes' }, { id: 'o2', text: 'No' }], votes: { alice: ['o1'] } });
let latest: ReturnType<typeof usePollResults>;
let renderer: ReactTestRenderer;
function Screen({ mid = 'old-poll', uid = 'me' }: { mid?: string; uid?: string }) {
  latest = usePollResults(cached, 'chat', mid, uid); return null;
}
function snapshot(poll: any, fromCache = false) {
  return { exists: () => true, metadata: { fromCache }, data: () => ({ type: 'poll', poll, senderUid: 'alice' }) };
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); state.uid = 'me'; state.listens = []; state.write.mockReset().mockResolvedValue(undefined); });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); vi.unstubAllGlobals(); });
describe('live results for polls outside the chat feed window', () => {
  it('replaces a stale cached voter list with every server voter and caches the update', async () => {
    await act(async () => { renderer = create(createElement(Screen)); });
    expect(latest.status).toBe('loading');
    expect(latest.poll?.voterCount).toBe(1);
    expect(state.listens[0].path).toBe('conversations/chat/messages/old-poll');
    const votes = Object.fromEntries(Array.from({ length: 521 }, (_, i) => [`user${i}`, ['o2']]));
    await act(async () => state.listens[0].next(snapshot({ ...cached, votes })));
    expect(latest.status).toBe('ready');
    expect(Object.keys(latest.poll!.votes)).toHaveLength(521);
    expect(latest.poll?.voterCount).toBe(521);
    expect(state.write).toHaveBeenCalledOnce();
    const saved = JSON.parse(state.write.mock.calls[0][0][0].payload);
    expect(saved.voterCount).toBe(521);
  });
  it('updates vote changes and withdrawals while the sheet stays open', async () => {
    await act(async () => { renderer = create(createElement(Screen)); });
    await act(async () => state.listens[0].next(snapshot({ ...cached, votes: { alice: ['o1'], bob: ['o2'] } })));
    await act(async () => state.listens[0].next(snapshot({ ...cached, votes: { bob: ['o1'] } })));
    expect(latest.poll?.votes).toEqual({ bob: ['o1'] });
    expect(latest.poll?.voterCount).toBe(1);
  });
  it('never treats an empty offline snapshot as a deleted poll or publishes identities for anonymous polls', async () => {
    await act(async () => { renderer = create(createElement(Screen)); });
    await act(async () => state.listens[0].next({ exists: () => false, metadata: { fromCache: true } }));
    expect(latest.status).toBe('loading');
    expect(latest.poll).toBe(cached);
    await act(async () => state.listens[0].next(snapshot({ ...cached, anonymous: true, votes: { secret: ['o1'] }, counts: { o1: 2 }, voterCount: 2 })));
    expect(latest.poll?.votes).toEqual({});
    expect(latest.poll?.voterCount).toBe(2);
    expect(JSON.parse(state.write.mock.calls[0][0][0].payload).votes).toEqual({});
    expect(state.listens).toHaveLength(1); // never reads pollVoters or profiles
  });
  it('clears cached identities when access is denied, and ignores callbacks after switching polls', async () => {
    await act(async () => { renderer = create(createElement(Screen)); });
    const previous = state.listens[0];
    await act(async () => previous.error({ code: 'permission-denied' }));
    expect(latest.status).toBe('unavailable'); expect(latest.poll).toBeNull();
    await act(async () => renderer.update(createElement(Screen, { mid: 'other-poll' })));
    expect(previous.stop).toHaveBeenCalledOnce();
    await act(async () => previous.next(snapshot({ ...cached, votes: { late: ['o2'] } })));
    expect(latest.poll).toBe(cached);
    expect(state.write).not.toHaveBeenCalled();
  });
  it('keeps cached results on a network error and can retry without another screen open', async () => {
    await act(async () => { renderer = create(createElement(Screen)); });
    await act(async () => state.listens[0].error({ code: 'unavailable' }));
    expect(latest.status).toBe('error'); expect(latest.poll).toBe(cached);
    await act(async () => latest.retry());
    expect(state.listens[0].stop).toHaveBeenCalledOnce(); expect(state.listens).toHaveLength(2);
    await act(async () => state.listens[1].next(snapshot(cached)));
    expect(latest.status).toBe('ready');
  });
  it.each(['deleted', 'missing', 'changed-type'])('removes cached results when the server reports a %s poll', async kind => {
    await act(async () => { renderer = create(createElement(Screen)); });
    await act(async () => state.listens[0].next(snapshot(cached)));
    expect(latest.status).toBe('ready');
    const removed = {
      exists: () => kind !== 'missing', metadata: { fromCache: false },
      data: () => ({ type: kind === 'changed-type' ? 'text' : 'poll', poll: cached, deletedForEveryone: kind === 'deleted' }),
    };
    await act(async () => state.listens[0].next(removed));
    expect(latest.status).toBe('unavailable');
    expect(latest.poll).toBeNull();
    await act(async () => renderer.unmount());
    expect(state.listens[0].stop).toHaveBeenCalledOnce();
  });
  it('does not write or display a late response for the previous signed-in account', async () => {
    await act(async () => { renderer = create(createElement(Screen)); });
    state.uid = 'other';
    await act(async () => state.listens[0].next(snapshot({ ...cached, votes: { late: ['o2'] } })));
    expect(latest.poll).toBe(cached);
    expect(state.write).not.toHaveBeenCalled();
  });
});
