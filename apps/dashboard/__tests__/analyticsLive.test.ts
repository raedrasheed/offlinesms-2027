import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { appendPresenceSample, useAnalytics } from '../app/admin/reports/useAnalytics';
import type { AnalyticsRange, AnalyticsLive } from '../lib/analytics';
const { create, act } = require('react-test-renderer');
let root: any, current: ReturnType<typeof useAnalytics>, online: boolean;
let doc: EventTarget & { visibilityState: string }, win: EventTarget, fetcher: ReturnType<typeof vi.fn>;
const live = (online = 3): AnalyticsLive => ({ updatedAt: new Date().toISOString(), online, active24h: 5, active7d: 6, active30d: 7, presenceCoverage: 8, relayOnline: null, relayQueued: null, relayInFlight: null, showUsers: true, showRelay: false, geography: null, issues: [] });
const response = (url: string, status = 200) => ({ status, ok: status === 200, json: async () => url.includes('kind=live') ? { live: live() } : { report: { range: new URL(url, 'http://test').searchParams.get('range'), sections: [], updatedAt: new Date().toISOString(), issues: [], limitations: [] } } });
function Harness({ range = '7d' }: { range?: AnalyticsRange }) { current = useAnalytics(range); return null; }
const mount = async () => { await act(async () => { root = create(createElement(Harness)); }); };
const tick = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T12:00:00Z')); online = true;
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' }); win = new EventTarget();
  vi.stubGlobal('document', doc); vi.stubGlobal('window', win); vi.stubGlobal('navigator', { get onLine() { return online; } }); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fetcher = vi.fn(); fetcher.mockImplementation((url: string) => Promise.resolve(response(url))); vi.stubGlobal('fetch', fetcher);
});
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('analytics refresh lifecycle', () => {
  it('loads independently, then refreshes presence every 5 seconds and reports every minute', async () => {
    await mount(); expect(fetcher).toHaveBeenCalledTimes(2); expect(current.report?.range).toBe('7d'); expect(current.live?.online).toBe(3);
    await tick(5_000); expect(fetcher).toHaveBeenCalledTimes(3); expect(current.samples.length).toBe(2);
    await tick(55_000); expect(fetcher.mock.calls.filter(([u]) => u.includes('kind=report'))).toHaveLength(2);
  });
  it('pauses hidden/offline requests and resumes with a gap instead of a false zero', async () => {
    await mount(); doc.visibilityState = 'hidden'; await act(async () => doc.dispatchEvent(new Event('visibilitychange'))); await tick(60_000);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(current.paused).toBe(true);
    doc.visibilityState = 'visible'; await act(async () => doc.dispatchEvent(new Event('visibilitychange'))); expect(fetcher).toHaveBeenCalledTimes(4);
    expect(current.samples.some(s => s.value === null)).toBe(true);
    online = false; await act(async () => win.dispatchEvent(new Event('offline'))); await tick(10_000); expect(fetcher).toHaveBeenCalledTimes(4);
    online = true; await act(async () => win.dispatchEvent(new Event('online'))); expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it.each([401, 403])('clears sensitive data and cancels all refreshes on %s', async status => {
    await mount(); fetcher.mockImplementation((url: string) => Promise.resolve(response(url, status)));
    await tick(5_000); expect(current.blocked).toBe(true); expect(current.report).toBeNull(); expect(current.live).toBeNull(); expect(current.samples).toEqual([]);
    const calls = fetcher.mock.calls.length; await tick(120_000); expect(fetcher).toHaveBeenCalledTimes(calls);
  });
  it('keeps the last snapshot on a transient failure and labels it stale, then recovers', async () => {
    await mount(); fetcher.mockImplementation((url: string) => Promise.resolve(response(url, 503))); await tick(5_000);
    expect(current.live?.online).toBe(3); expect(current.liveError).toContain('stale'); expect(current.samples.at(-1)?.value).toBeNull();
    fetcher.mockImplementation((url: string) => Promise.resolve(response(url))); await tick(5_000); expect(current.liveError).toBeNull();
  });
  it('ignores obsolete range results and aborts requests on navigation', async () => {
    await mount(); let resolve!: (value: unknown) => void; let signal!: AbortSignal;
    fetcher.mockImplementationOnce((_: string, opts: { signal: AbortSignal }) => { signal = opts.signal; return new Promise(r => { resolve = r; }); });
    await tick(5_000); await act(async () => root.update(createElement(Harness, { range: '90d' }))); expect(signal.aborted).toBe(true);
    await act(async () => resolve(response('?kind=live'))); expect(current.report?.range).toBe('90d');
    await act(async () => root.unmount()); root = null; const calls = fetcher.mock.calls.length; await tick(60_000); expect(fetcher).toHaveBeenCalledTimes(calls);
  });
  it('coalesces multiple triggers while each kind is in flight and times out stalled requests', async () => {
    fetcher.mockImplementation((_: string, opts: { signal: AbortSignal }) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(Error('abort')))));
    await mount(); await tick(10_000); await act(async () => current.refresh()); expect(fetcher).toHaveBeenCalledTimes(2);
    await tick(15_000); expect(current.error).toContain('could not be loaded'); expect(current.liveError).toContain('stale');
  });
  it('bounds the in-console series and never duplicates a cached sample', () => {
    let points = appendPresenceSample([], live()); expect(appendPresenceSample(points, live())).toBe(points);
    for (let i = 0; i < 150; i++) { vi.advanceTimersByTime(5_000); points = appendPresenceSample(points, live()); }
    expect(points).toHaveLength(120); expect(new Set(points.map(p => p.date)).size).toBe(120);
  });
});
