import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const state = vi.hoisted(() => ({ listeners: [] as any[], paths: [] as string[], stopped: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: (_: unknown, ...path: string[]) => path.join('/'),
  onSnapshot: (path: string, _: unknown, next: any, error: any) => { state.paths.push(path); state.listeners.push({ next, error }); return state.stopped; },
}));
vi.mock('../src/lib/firebase', () => ({ db: {} }));
vi.mock('../src/localdb/connection', () => ({ getCurrentUid: () => null }));
import { useOwnPollVote } from '../src/hooks/useOwnPollVote';
let renderer: ReactTestRenderer;
let value: ReturnType<typeof useOwnPollVote>;
function Probe({ uid = 'alice', enabled = true }: { uid?: string; enabled?: boolean }) {
  value = useOwnPollVote('chat', 'poll', uid, enabled); return null;
}
async function mount(props = {}) { await act(async () => { renderer = create(createElement(Probe, props)); }); }
async function snapshot(index: number, data: unknown, fromCache = false) { await act(async () => state.listeners[index].next({ exists: () => !!data, data: () => data, metadata: { fromCache } })); }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); state.listeners = []; state.paths = []; state.stopped.mockReset(); });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); vi.unstubAllGlobals(); });
describe('own ballot listener', () => {
  it('does not mistake an empty offline cache for an uncast vote', async () => {
    await mount(); await snapshot(0, undefined, true); expect(value.known).toBe(false);
    await snapshot(0, undefined, false); expect(value).toMatchObject({ known: true, selection: [] });
  });
  it('reads only this account and ignores stale responses', async () => {
    await mount(); expect(state.paths).toEqual(['conversations/chat/messages/poll/pollVoters/alice']);
    await snapshot(0, { optionIds: ['o2'], seq: 20 }); await snapshot(0, { optionIds: ['o1'], seq: 10 });
    expect(value).toMatchObject({ selection: ['o2'], seq: 20 });
  });
  it('clears choices on account change and ignores detached callbacks', async () => {
    await mount(); await snapshot(0, { optionIds: ['o2'], seq: 20 });
    await act(async () => renderer.update(createElement(Probe, { uid: 'bob' })));
    expect(state.stopped).toHaveBeenCalledOnce(); expect(value.known).toBe(false);
    await snapshot(0, { optionIds: ['o1'], seq: 30 }); expect(value.known).toBe(false);
    await snapshot(1, undefined); expect(value).toMatchObject({ known: true, selection: [] });
  });
  it('does not attach private listeners to public or pending polls', async () => {
    await mount({ enabled: false }); expect(state.paths).toEqual([]);
  });
});
