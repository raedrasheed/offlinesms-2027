import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsBuckets, analyticsNumber, AnalyticsCache, finiteAggregate, parseAnalyticsRange } from '../lib/analytics';
import { registrationCountry, isFreshPresence } from '../lib/analyticsGeography';
import { Timestamp } from 'firebase-admin/firestore';
const mock = vi.hoisted(() => ({ session: {} as any, report: vi.fn(), live: vi.fn(), limited: false }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'session' }) }) }));
vi.mock('../lib/session', () => ({ verifySession: async () => mock.session }));
vi.mock('../lib/analyticsData', () => ({ getAnalyticsReport: mock.report, getAnalyticsLive: mock.live }));
vi.mock('../lib/rateLimit', () => ({ checkRateLimit: () => ({ ok: !mock.limited, retryAfterMs: 7000 }) }));
import { GET } from '../app/api/admin/analytics/route';
const request = (query = '') => new Request(`https://dash.offlinesms.com/api/admin/analytics${query}`);
beforeEach(() => { mock.session = { state: 'authorized', role: 'super_admin', user: { uid: 'admin', claims: {} } }; mock.report.mockReset(); mock.live.mockReset(); mock.limited = false; });
afterEach(() => { vi.useRealTimers(); });
describe('analytics access and transport', () => {
  it.each(['unauthenticated', 'forbidden'])('refuses %s before reading data', async state => {
    mock.session = { state }; expect((await GET(request())).status).toBe(state === 'unauthenticated' ? 401 : 403);
    expect(mock.report).not.toHaveBeenCalled(); expect(mock.live).not.toHaveBeenCalled();
  });
  it.each(['support_agent', 'unknown'])('refuses a role without reports: %s', async role => {
    mock.session.role = role; expect((await GET(request())).status).toBe(403); expect(mock.report).not.toHaveBeenCalled();
  });
  it.each([{ role: 'organization_admin', organizationId: 'org-a' }, { roles: ['finance_admin'] }, { role: 'auditor' }])('does not expand stale admin:true over explicit restricted claims %j', async claims => {
    mock.session.role = 'legacy_admin'; mock.session.user.claims = { admin: true, ...claims };
    expect((await GET(request())).status).toBe(403); expect(mock.report).not.toHaveBeenCalled();
  });
  it('passes verified org context, ignores requested scope and disables browser/proxy caching', async () => {
    mock.session.role = 'organization_admin'; mock.session.user.claims = { organizationId: 'org-a' };
    mock.report.mockResolvedValue({ scope: 'Organization' });
    const response = await GET(request('?kind=report&range=90d&organizationId=org-b'));
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toContain('no-store'); expect(response.headers.get('Vary')).toBe('Cookie');
    expect(mock.report).toHaveBeenCalledWith(mock.session, '90d'); expect(mock.live).not.toHaveBeenCalled();
  });
  it('returns live activity independently of slower reports', async () => {
    mock.live.mockResolvedValue({ online: 2 }); const response = await GET(request('?kind=live'));
    expect(await response.json()).toEqual({ live: { online: 2 } }); expect(mock.report).not.toHaveBeenCalled();
  });
  it.each(['?range=1y', '?kind=raw', '?range=7d%27'])('rejects invalid query %s', async query => {
    expect((await GET(request(query))).status).toBe(400); expect(mock.report).not.toHaveBeenCalled();
  });
  it('rate-limits and provides retry delay', async () => {
    mock.limited = true; const response = await GET(request()); expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('7'); expect(mock.report).not.toHaveBeenCalled();
  });
  it('returns sanitized service failures rather than false zeros or secrets', async () => {
    mock.live.mockRejectedValue(new Error('private key, token, index URL'));
    const response = await GET(request('?kind=live')); expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toMatch(/private key|token|index URL/);
  });
});
describe('analytics definitions', () => {
  it.each(['7d', '30d', '90d'] as const)('covers exactly %s calendar days including the present day, with no future interval', range => {
    const now = new Date('2026-01-01T12:30:00Z'), rows = analyticsBuckets(range, now);
    expect(rows).toHaveLength(range === '90d' ? 13 : Number(range.slice(0, -1)));
    expect(rows.at(-1)!.end.toISOString()).toBe(now.toISOString());
    expect(now.getTime() - rows[0].start.getTime()).toBe((Number(range.slice(0, -1)) - 1) * 86400000 + 45000000);
    rows.slice(1).forEach((r, i) => expect(r.start.getTime()).toBe(rows[i].end.getTime()));
  });
  it('includes a zero-length present-day bucket at exactly UTC midnight', () => {
    const rows = analyticsBuckets('7d', new Date('2026-01-01T00:00:00Z')); expect(rows.at(-1)!.start.getTime()).toBe(rows.at(-1)!.end.getTime());
  });
  it('does not confuse missing values, invalid sums and zero', () => {
    expect(analyticsNumber(null)).toBe('—'); expect(analyticsNumber(0)).toBe('0'); expect(finiteAggregate(0)).toBe(0); expect(() => finiteAggregate(NaN)).toThrow(); expect(parseAnalyticsRange('invalid')).toBe('7d');
  });
  it('requires both an explicit online flag and a fresh, non-future heartbeat', () => {
    const now = Date.now(); const data = (offset: number, online = true) => ({ online, lastSeen: Timestamp.fromMillis(now + offset) });
    expect(isFreshPresence(data(-45_000), now)).toBe(true); expect(isFreshPresence(data(-45_001), now)).toBe(false);
    expect(isFreshPresence(data(1), now)).toBe(false); expect(isFreshPresence(data(-1, false), now)).toBe(false); expect(isFreshPresence({ online: true }, now)).toBe(false);
  });
  it('uses validated full phone metadata rather than guessing from a prefix', () => {
    expect(registrationCountry('+970599123456')).toBe('PS'); expect(registrationCountry('+12025550123')).toBe('US');
    expect(registrationCountry('+14165550123')).toBe('CA'); expect(registrationCountry('+442079460018')).toBe('GB');
    for (const v of [undefined, null, '+1', '970599123456', 'private', '+9999999999999']) expect(registrationCountry(v)).toBeNull();
  });
});
describe('coalesced bounded cache', () => {
  it('separates role/org/range keys, expires values and coalesces concurrent loads', async () => {
    const cache = new AnalyticsCache<number>(10, 2), load = vi.fn().mockResolvedValue(1);
    const a = cache.get('role:org-a:7d', load, 100), b = cache.get('role:org-a:7d', load, 101); expect(a).toBe(b); await a; expect(load).toHaveBeenCalledTimes(1);
    await cache.get('role:org-b:7d', load, 102); await cache.get('role:org-a:30d', load, 103);
    await cache.get('role:org-a:7d', load, 104); expect(load).toHaveBeenCalledTimes(4);
    await cache.get('role:org-a:7d', load, 115); expect(load).toHaveBeenCalledTimes(5);
  });
  it('evicts rejected loads so later calls recover', async () => {
    const cache = new AnalyticsCache<number>(100); await expect(cache.get('x', async () => { throw Error('offline'); })).rejects.toThrow();
    expect(await cache.get('x', async () => 4)).toBe(4);
  });
});
