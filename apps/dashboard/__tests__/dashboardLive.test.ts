// Exercise the production client component's requests, state and lifecycle.
// Charts are an independent rendering boundary; no browser DOM is required.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import type { DashboardOverview as Overview } from '../lib/dashboardOverview';
vi.mock('../app/admin/DashboardCharts', () => ({ TrendChart: () => null, BatchStatusChart: () => null }));
vi.mock('next/link', () => ({ default: ({ children }: { children: unknown }) => children }));
import DashboardOverview from '../app/admin/DashboardOverview';
const { create, act } = require('react-test-renderer');

let root: any;
let doc: EventTarget & { visibilityState: string };
let win: EventTarget;
let online: boolean;
let fetcher: ReturnType<typeof vi.fn>;
function fixture(value = 1): Overview {
  return { generatedAt: new Date().toISOString(), scope: 'Platform', metrics: [{ key: 'users', label: 'Total users', value, note: 'Current total' }], issues: [], smsTrend: null, pointsTrend: null, batchStatuses: null, recentBatches: null, relay: null };
}
const response = (value = 2, status = 200) => ({ status, ok: status === 200, json: async () => fixture(value) });
const rendered = () => JSON.stringify(root.toJSON());
const usersValue = () => root.root.findByProps({ 'data-metric': 'users' }).findAllByType('p')[0].children[0];
const mount = async () => { await act(async () => { root = create(createElement(DashboardOverview, { initialData: fixture() })); }); };
const tick = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
const click = async () => { await act(async () => { await root.root.findByType('button').props.onClick(); }); };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' }); win = new EventTarget(); online = true;
  vi.stubGlobal('document', doc); vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', { get onLine() { return online; } });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fetcher = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetcher);
});
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('live dashboard lifecycle', () => {
  it('renders the server snapshot then refreshes automatically without navigating', async () => {
    await mount(); expect(fetcher).not.toHaveBeenCalled(); expect(usersValue()).toBe('1');
    await tick(15_000); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/admin/overview');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
    expect(usersValue()).toBe('2'); expect(rendered()).toContain('Live updates enabled');
  });
  it('pauses hidden/offline tabs and resumes when visibility and connection return', async () => {
    await mount(); doc.visibilityState = 'hidden'; await tick(30_000); expect(fetcher).not.toHaveBeenCalled();
    doc.visibilityState = 'visible'; await act(async () => { doc.dispatchEvent(new Event('visibilitychange')); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    online = false; await act(async () => { win.dispatchEvent(new Event('offline')); });
    await tick(30_000); expect(fetcher).toHaveBeenCalledTimes(1); expect(rendered()).toContain('You are offline');
    online = true; await act(async () => { win.dispatchEvent(new Event('online')); });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(rendered()).not.toContain('You are offline');
  });
  it('retains the previous snapshot on failure and recovers on a later refresh', async () => {
    await mount(); fetcher.mockResolvedValue(response(2, 503)); await click();
    expect(rendered()).toContain('Refresh failed'); expect(usersValue()).toBe('1');
    fetcher.mockResolvedValue(response(3)); await tick(15_000);
    expect(rendered()).not.toContain('Refresh failed'); expect(usersValue()).toBe('3'); expect(rendered()).toContain('Live updates enabled');
  });
  it('coalesces clicks/intervals while a request is in flight', async () => {
    await mount(); let resolve!: (v: unknown) => void;
    fetcher.mockReturnValue(new Promise(r => { resolve = r; }));
    await act(async () => { root.root.findByType('button').props.onClick(); root.root.findByType('button').props.onClick(); });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(root.root.findByType('button').props.disabled).toBe(true);
    await act(async () => { resolve(response()); });
    expect(root.root.findByType('button').props.disabled).toBe(false);
  });
  it.each([401, 403])('clears data and stops polling on status %s', async status => {
    await mount(); fetcher.mockResolvedValue(response(2, status)); await click();
    expect(root.root.findAllByProps({ 'data-metric': 'users' })).toHaveLength(0); expect(rendered()).toContain('access has changed');
    await tick(60_000); expect(fetcher).toHaveBeenCalledTimes(1); expect(root.root.findByType('button').props.disabled).toBe(true);
  });
  it('aborts pending requests when navigating away and removes timers/listeners', async () => {
    await mount(); let signal!: AbortSignal;
    fetcher.mockImplementation((_: unknown, options: { signal: AbortSignal }) => { signal = options.signal; return new Promise(() => {}); });
    await act(async () => { root.root.findByType('button').props.onClick(); });
    await act(async () => root.unmount()); root = null;
    expect(signal.aborted).toBe(true); await tick(60_000);
    win.dispatchEvent(new Event('online')); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('times out a hung refresh and retries on the following interval', async () => {
    await mount();
    fetcher.mockImplementationOnce((_: unknown, options: { signal: AbortSignal }) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    await act(async () => { root.root.findByType('button').props.onClick(); });
    await tick(12_000); expect(rendered()).toContain('Refresh failed');
    await tick(3_000); expect(fetcher).toHaveBeenCalledTimes(2); expect(rendered()).not.toContain('Refresh failed');
  });
  it('ignores an obsolete response after the server snapshot changes', async () => {
    await mount(); let resolve!: (v: unknown) => void;
    fetcher.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    await act(async () => { root.root.findByType('button').props.onClick(); });
    await act(async () => { root.update(createElement(DashboardOverview, { initialData: fixture(7) })); });
    await act(async () => { resolve(response(2)); });
    expect(usersValue()).toBe('7');
  });
});
