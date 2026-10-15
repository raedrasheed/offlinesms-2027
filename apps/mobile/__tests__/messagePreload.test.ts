import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMessagePreload, type PreloadChat } from '../src/localdb/sync/messagePreload';
const chat = (id: string, at = 1, unread = 0): PreloadChat => ({ id, last_message_id: `${id}-${at}`,
  last_message_at: at, unread_count: unread, archived: 0, status: 'active' });
const settle = async () => { for (let n = 0; n < 100; n++) await Promise.resolve(); };
function fixture() {
  let enabled = true;
  const stops: Array<ReturnType<typeof vi.fn>> = [];
  const listen = vi.fn((_id: string, _server: () => void, _error: () => void) => {
    const stop = vi.fn(); stops.push(stop); return stop;
  });
  const fetch = vi.fn(async (_id: string) => {});
  const preload = createMessagePreload({ canRun: () => enabled, fetchRecent: fetch, listen });
  return { preload, listen, fetch, stops, setEnabled: (value: boolean) => { enabled = value; } };
}
afterEach(() => { vi.useRealTimers(); });

describe('foreground message preload', () => {
  it('prefetches only eight chats with two requests at a time and at most three live feeds', async () => {
    const f = fixture(); let active = 0; let maximum = 0;
    f.fetch.mockImplementation(async () => { active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--; });
    f.preload.update(Array.from({ length: 50 }, (_, i) => chat(`c${i}`, i)));
    await settle();
    expect(f.fetch).toHaveBeenCalledTimes(8);
    expect(maximum).toBe(2);
    expect(f.listen).toHaveBeenCalledTimes(3);
    expect(f.fetch.mock.calls[0][0]).toBe('c49');
    f.preload.stop();
  });

  it('prioritizes unread chats and does not repeat requests for user-state-only changes', async () => {
    const f = fixture();
    f.preload.update([chat('latest', 100), chat('unread', 10, 1)]);
    await settle();
    expect(f.fetch.mock.calls[0][0]).toBe('unread');
    f.preload.update([chat('latest', 100), chat('unread', 10, 2)]);
    await settle();
    expect(f.fetch).toHaveBeenCalledTimes(2);
    f.preload.stop();
  });

  it('fetches a newly changed older chat even when it is outside the first eight', async () => {
    const f = fixture();
    const rows = Array.from({ length: 10 }, (_, i) => chat(`c${i}`, 100 + i));
    f.preload.update(rows); await settle(); f.fetch.mockClear();
    f.preload.update(rows.map(c => c.id === 'c0' ? { ...c, last_message_id: 'new-server-id' } : c));
    await settle();
    expect(f.fetch.mock.calls).toEqual([['c0']]);
    f.preload.stop();
  });

  it('uses an already live feed instead of fetching another page for every incoming message', async () => {
    const f = fixture(); f.preload.update([chat('c')]); await settle();
    f.listen.mock.calls[0][1](); f.fetch.mockClear();
    f.preload.update([chat('c', 2)]); await settle();
    expect(f.fetch).not.toHaveBeenCalled();
    f.preload.stop();
  });

  it('does not drop a newer revision arriving during an in-flight preload', async () => {
    const f = fixture(); let resolve!: () => void;
    f.fetch.mockImplementationOnce(() => new Promise<void>(r => { resolve = r; }));
    f.preload.update([chat('c', 1)]); await settle();
    f.preload.update([chat('c', 2)]); resolve(); await settle();
    expect(f.fetch).toHaveBeenCalledTimes(2);
    f.preload.stop();
  });

  it('pauses listeners and queued requests in background, then revalidates on foreground', async () => {
    const f = fixture(); f.preload.update([chat('c')]); await settle();
    f.setEnabled(false); f.preload.pause();
    expect(f.stops[0]).toHaveBeenCalledOnce();
    f.preload.update([chat('c', 2)]); await settle();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    f.setEnabled(true); f.preload.resume(); await settle();
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.listen).toHaveBeenCalledTimes(2);
    f.preload.stop();
  });

  it('bounds retries and permits another attempt after reconnect', async () => {
    vi.useFakeTimers(); const f = fixture(); f.fetch.mockRejectedValue(new Error('offline'));
    f.preload.update([chat('c')]); await vi.advanceTimersByTimeAsync(10000);
    expect(f.fetch).toHaveBeenCalledTimes(3);
    f.fetch.mockResolvedValue(undefined); f.preload.resume(); await settle();
    expect(f.fetch).toHaveBeenCalledTimes(4);
    f.preload.stop();
  });

  it('does not restart work after logout/stop or a queued callback', async () => {
    const f = fixture(); f.preload.update([chat('c')]); f.preload.stop(); await settle();
    f.listen.mock.calls[0][1](); f.preload.resume(); f.preload.update([chat('other')]); await settle();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.stops[0]).toHaveBeenCalledOnce();
  });
});
