import { describe, expect, it, vi } from 'vitest';
import { openConversation, type ConversationOpenSteps } from '../src/hooks/conversationOpen';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function fixture() {
  const stopLive = vi.fn();
  const steps = {
    openDb: vi.fn(async () => {}),
    readClearedAt: vi.fn(async () => 42),
    showLocal: vi.fn(async (_clearedAt: number) => {}),
    startLive: vi.fn(() => stopLive),
    maintain: vi.fn(async () => {}),
    onReadError: vi.fn(),
  } satisfies ConversationOpenSteps;
  return { steps, stopLive };
}

describe('conversation opening', () => {
  it('shows saved messages and attaches the live feed while maintenance is stalled', async () => {
    const { steps } = fixture();
    const maintenance = deferred<void>();
    steps.maintain.mockImplementation(() => maintenance.promise);
    const cancel = openConversation(steps);
    await settle();
    expect(steps.showLocal).toHaveBeenCalledWith(42);
    expect(steps.startLive).toHaveBeenCalledOnce();
    expect(steps.maintain).toHaveBeenCalledOnce();
    expect(steps.showLocal.mock.invocationCallOrder[0]).toBeLessThan(steps.maintain.mock.invocationCallOrder[0]);
    expect(steps.startLive.mock.invocationCallOrder[0]).toBeLessThan(steps.maintain.mock.invocationCallOrder[0]);
    maintenance.resolve();
    cancel();
  });

  it('reads the clear-chat watermark before allowing any saved messages to appear', async () => {
    const { steps } = fixture();
    const watermark = deferred<number>();
    steps.readClearedAt.mockImplementation(() => watermark.promise);
    const cancel = openConversation(steps);
    await settle();
    expect(steps.showLocal).not.toHaveBeenCalled();
    expect(steps.startLive).not.toHaveBeenCalled();
    watermark.resolve(1234);
    await settle();
    expect(steps.showLocal).toHaveBeenCalledWith(1234);
    cancel();
  });

  it('starts network work while the initial local read is pending, with local read queued first', async () => {
    const { steps } = fixture();
    const read = deferred<void>();
    steps.showLocal.mockImplementation(() => read.promise);
    const cancel = openConversation(steps);
    await settle();
    expect(steps.showLocal).toHaveBeenCalledOnce();
    expect(steps.startLive).toHaveBeenCalledOnce();
    expect(steps.showLocal.mock.invocationCallOrder[0]).toBeLessThan(steps.startLive.mock.invocationCallOrder[0]);
    expect(steps.maintain).not.toHaveBeenCalled();
    read.resolve();
    await settle();
    expect(steps.startLive).toHaveBeenCalledOnce();
    cancel();
  });

  it.each(['openDb', 'readClearedAt', 'showLocal'] as const)(
    'does not attach late listeners or start maintenance after leaving during %s', async phase => {
      const { steps, stopLive } = fixture();
      const pending = deferred<any>();
      steps[phase].mockImplementation(() => pending.promise);
      const cancel = openConversation(steps);
      await settle();
      cancel();
      pending.resolve(42);
      await settle();
      if (phase !== 'showLocal') expect(steps.showLocal).not.toHaveBeenCalled();
      expect(steps.startLive).toHaveBeenCalledTimes(phase === 'showLocal' ? 1 : 0);
      expect(steps.maintain).not.toHaveBeenCalled();
      expect(stopLive).toHaveBeenCalledTimes(phase === 'showLocal' ? 1 : 0);
      expect(steps.onReadError).not.toHaveBeenCalled();
    },
  );

  it('detaches the live listener exactly once when leaving during maintenance', async () => {
    const { steps, stopLive } = fixture();
    const maintenance = deferred<void>();
    steps.maintain.mockImplementation(() => maintenance.promise);
    const cancel = openConversation(steps);
    await settle();
    cancel();
    cancel();
    expect(stopLive).toHaveBeenCalledOnce();
    maintenance.resolve();
    await settle();
    expect(steps.startLive).toHaveBeenCalledOnce();
  });

  it('keeps local messages and the live listener when maintenance fails', async () => {
    const { steps, stopLive } = fixture();
    steps.maintain.mockRejectedValue(new Error('migration unavailable'));
    const cancel = openConversation(steps);
    await settle();
    expect(steps.showLocal).toHaveBeenCalledOnce();
    expect(steps.startLive).toHaveBeenCalledOnce();
    expect(steps.onReadError).not.toHaveBeenCalled();
    expect(stopLive).not.toHaveBeenCalled();
    cancel();
  });

  it.each(['openDb', 'readClearedAt', 'showLocal'] as const)('falls back if %s fails', async phase => {
    const { steps } = fixture();
    steps[phase].mockRejectedValue(new Error('unavailable'));
    const cancel = openConversation(steps);
    await settle();
    expect(steps.onReadError).toHaveBeenCalledOnce();
    expect(steps.startLive).toHaveBeenCalledTimes(phase === 'showLocal' ? 1 : 0);
    expect(steps.maintain).not.toHaveBeenCalled();
    cancel();
  });

  it('ignores an old screen failure while another conversation opens', async () => {
    const old = fixture();
    const next = fixture();
    const db = deferred<void>();
    old.steps.openDb.mockImplementation(() => db.promise);
    const cancelOld = openConversation(old.steps);
    cancelOld();
    const cancelNext = openConversation(next.steps);
    db.reject(new Error('late failure'));
    await settle();
    expect(old.steps.onReadError).not.toHaveBeenCalled();
    expect(old.steps.showLocal).not.toHaveBeenCalled();
    expect(next.steps.showLocal).toHaveBeenCalledWith(42);
    expect(next.steps.startLive).toHaveBeenCalledOnce();
    cancelNext();
  });
});
