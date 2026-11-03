import { describe, expect, it, vi } from 'vitest';
import { createPendingClipNavigation } from '../src/lib/pendingClipNavigation';
function setup() {
  const state = { stored: null as string | null, account: 'a' as string | null, ready: false };
  const open = vi.fn();
  const controller = createPendingClipNavigation({
    take: async () => { const id = state.stored; state.stored = null; return id; },
    save: async id => { state.stored = id; }, account: () => state.account, ready: () => state.ready, open,
  });
  return { state, open, controller };
}
describe('protected clip navigation queue', () => {
  it('opens a cold-start link received after auth replay but before the navigator is ready', async () => {
    const { state, open, controller } = setup();
    await controller.drain(); await controller.receive('cold-start');
    expect(open).not.toHaveBeenCalled(); expect(state.stored).toBe('cold-start');
    state.ready = true; await controller.drain();
    expect(open).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledWith('cold-start'); expect(state.stored).toBeNull();
  });
  it('drains a warm link after persistence and replays a signed-out link after login', async () => {
    const { state, open, controller } = setup(); state.ready = true;
    await controller.receive('warm'); expect(open).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledWith('warm');
    state.account = null; await controller.receive('after-login'); expect(open).toHaveBeenCalledTimes(1);
    state.account = 'b'; await controller.drain(); expect(open).toHaveBeenLastCalledWith('after-login');
  });
  it('does not navigate a result taken under an account that changed during the read', async () => {
    let finish!: (id: string) => void, account: string | null = 'a', saved: string | null = null;
    const open = vi.fn();
    const controller = createPendingClipNavigation({ take: () => new Promise(resolve => { finish = resolve; }),
      save: async id => { saved = id; }, account: () => account, ready: () => true, open });
    const pending = controller.drain(); await Promise.resolve(); account = null; finish('private-reference'); await pending;
    expect(open).not.toHaveBeenCalled(); expect(saved).toBe('private-reference');
  });
  it('coalesces competing readiness callbacks without duplicate navigation', async () => {
    const { state, open, controller } = setup(); state.stored = 'only-once'; state.ready = true;
    await Promise.all([controller.drain(), controller.drain(), controller.drain()]);
    expect(open).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledWith('only-once');
  });
  it('does not lose a readiness event received while putting an old-account read back', async () => {
    let finish!: (id: string) => void, account = 'a', saved: string | null = null, first = true;
    const open = vi.fn();
    const controller = createPendingClipNavigation({
      take: async () => { if (first) { first = false; return new Promise<string>(resolve => { finish = resolve; }); } const id = saved; saved = null; return id; },
      save: async id => { saved = id; }, account: () => account, ready: () => true, open,
    });
    const pending = controller.drain(); await Promise.resolve(); account = 'b';
    await controller.drain(); finish('replayed-reference'); await pending;
    expect(open).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledWith('replayed-reference');
  });
  it('keeps a newer incoming link instead of restoring an older consumed link over it', async () => {
    let finish!: (id: string) => void, account = 'a', saved: string | null = null, first = true;
    const open = vi.fn();
    const controller = createPendingClipNavigation({
      take: async () => { if (first) { first = false; return new Promise<string>(resolve => { finish = resolve; }); } const id = saved; saved = null; return id; },
      save: async id => { saved = id; }, account: () => account, ready: () => true, open,
    });
    const pending = controller.drain(); await Promise.resolve(); account = 'b';
    const incoming = controller.receive('newer'); finish('older'); await Promise.all([pending, incoming]);
    expect(open).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledWith('newer');
  });
});
