import { describe, expect, it, vi, beforeEach } from 'vitest';
import { dashboardDays, formatDashboardNumber } from '../lib/dashboardOverview';

const state = vi.hoisted(() => ({ session: {} as any, load: vi.fn(), limited: false }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'session' }) }) }));
vi.mock('../lib/session', () => ({ verifySession: async () => state.session }));
vi.mock('../lib/dashboardData', () => ({ getDashboardOverview: state.load }));
vi.mock('../lib/rateLimit', () => ({ checkRateLimit: () => ({ ok: !state.limited, retryAfterMs: 4000 }) }));
import { GET } from '../app/api/admin/overview/route';

beforeEach(() => { state.session = { state: 'authorized', role: 'super_admin', user: { uid: 'a' } }; state.load.mockReset(); state.limited = false; });

describe('overview endpoint', () => {
  it('refuses missing sessions and forbidden accounts without querying Firestore', async () => {
    state.session = { state: 'unauthenticated' }; expect((await GET()).status).toBe(401);
    state.session = { state: 'forbidden' }; expect((await GET()).status).toBe(403);
    state.session = { state: 'authorized', role: 'unknown', user: { uid: 'a' } }; expect((await GET()).status).toBe(403);
    expect(state.load).not.toHaveBeenCalled();
  });
  it('passes only verified session context and prevents shared/browser caching', async () => {
    state.load.mockResolvedValue({ metrics: [], scope: 'Platform' });
    const response = await GET(); expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store'); expect(response.headers.get('Vary')).toBe('Cookie');
    expect(state.load).toHaveBeenCalledWith(state.session); expect(await response.json()).toEqual({ metrics: [], scope: 'Platform' });
  });
  it('limits refresh abuse without loading data', async () => {
    state.limited = true; const response = await GET();
    expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('4'); expect(state.load).not.toHaveBeenCalled();
  });
  it('does not expose backend exception details or manufacture zeros', async () => {
    state.load.mockRejectedValue(new Error('private credentials'));
    const response = await GET(); expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('private credentials');
  });
});

describe('overview calendar and formatting', () => {
  it('uses UTC, includes today and never includes future time in the last bucket', () => {
    const now = new Date('2026-01-01T00:00:00.000Z'); const days = dashboardDays(now);
    expect(days[0].date).toBe('2025-12-26'); expect(days[6].date).toBe('2026-01-01');
    expect(days[6].start.toISOString()).toBe(now.toISOString()); expect(days[6].end.toISOString()).toBe(now.toISOString());
    expect(days[5].end.toISOString()).toBe(now.toISOString());
  });
  it('distinguishes zero from unavailable without approximate values', () => {
    expect(formatDashboardNumber(0)).toBe('0'); expect(formatDashboardNumber(null)).toBe('Unavailable'); expect(formatDashboardNumber(1234)).toBe('1,234');
  });
});
