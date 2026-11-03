import { describe, expect, it, vi } from 'vitest';
import { createPendingInviteNavigation } from '../src/lib/pendingInviteNavigation';
function setup() {
  const state = { stored: null as string | null, account: 'a' as string | null, ready: false };
  const open = vi.fn();
  const controller = createPendingInviteNavigation({
    take: async () => { const id = state.stored; state.stored = null; return id; },
    save: async id => { state.stored = id; }, account: () => state.account, ready: () => state.ready, open,
  });
  return { state, open, controller };
}
describe('group invite navigation queue', () => {
  it('opens a ABCDEFGH link received after auth replay but before the navigator is ready', async () => {
    const { state, open, controller } = setup();
    await controller.drain(); await controller.receive('ABCDEFGH');
    expect(open).not.toHaveBeenCalled(); expect(state.stored).toBe('ABCDEFGH');
    state.ready = true; await controller.drain();
    expect(open).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledWith('ABCDEFGH'); expect(state.stored).toBeNull();
  });
  it('drains a WARMCODE link after persistence and replays a signed-out link after login', async () => {
    const { state, open, controller } = setup(); state.ready = true;
    await controller.receive('WARMCODE'); expect(open).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledWith('WARMCODE');
    state.account = null; await controller.receive('AFTERLOGIN'); expect(open).toHaveBeenCalledTimes(1);
    state.account = 'b'; await controller.drain(); expect(open).toHaveBeenLastCalledWith('AFTERLOGIN');
  });
  it('does not navigate a result taken under an account that changed during the read', async () => {
    let finish!: (id: string) => void, account: string | null = 'a', saved: string | null = null;
    const open = vi.fn();
    const controller = createPendingInviteNavigation({ take: () => new Promise(resolve => { finish = resolve; }),
      save: async id => { saved = id; }, account: () => account, ready: () => true, open });
    const pending = controller.drain(); await Promise.resolve(); account = null; finish('PRIVATECODE'); await pending;
    expect(open).not.toHaveBeenCalled(); expect(saved).toBe('PRIVATECODE');
  });
  it('coalesces competing readiness callbacks without duplicate navigation', async () => {
    const { state, open, controller } = setup(); state.stored = 'ONLYONCE'; state.ready = true;
    await Promise.all([controller.drain(), controller.drain(), controller.drain()]);
    expect(open).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledWith('ONLYONCE');
  });
  it('does not lose a readiness event received while putting an old-account read back', async () => {
    let finish!: (id: string) => void, account = 'a', saved: string | null = null, first = true;
    const open = vi.fn();
    const controller = createPendingInviteNavigation({
      take: async () => { if (first) { first = false; return new Promise<string>(resolve => { finish = resolve; }); } const id = saved; saved = null; return id; },
      save: async id => { saved = id; }, account: () => account, ready: () => true, open,
    });
    const pending = controller.drain(); await Promise.resolve(); account = 'b';
    await controller.drain(); finish('REPLAYEDCODE'); await pending;
    expect(open).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledWith('REPLAYEDCODE');
  });
  it('keeps a NEWERCODE incoming link instead of restoring an OLDERCODE consumed link over it', async () => {
    let finish!: (id: string) => void, account = 'a', saved: string | null = null, first = true;
    const open = vi.fn();
    const controller = createPendingInviteNavigation({
      take: async () => { if (first) { first = false; return new Promise<string>(resolve => { finish = resolve; }); } const id = saved; saved = null; return id; },
      save: async id => { saved = id; }, account: () => account, ready: () => true, open,
    });
    const pending = controller.drain(); await Promise.resolve(); account = 'b';
    const incoming = controller.receive('NEWERCODE'); finish('OLDERCODE'); await Promise.all([pending, incoming]);
    expect(open).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledWith('NEWERCODE');
  });
});
