import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
const fake = vi.hoisted(() => ({ count: 0, fail: false }));
vi.mock('../lib/firebase-admin', () => ({ adminDb: { collection: () => ({
  doc() { return this; }, collection() { return this; },
  count: () => ({ get: async () => { fake.count++; if (fake.fail) throw new Error('unavailable'); return { data: () => ({ count: fake.count }) }; } }),
}) } }));
// Finance/support paths are suppressed here so each role's deliberately small
// data set makes cache isolation observable without mocking the loader itself.
vi.mock('../lib/adminPermissions', () => ({ canDo: (_: string, cap: string) => cap === 'view:overview' || cap === 'view:users' }));
import { getDashboardOverview } from '../lib/dashboardData';
import type { SessionResult } from '../lib/session';
const as = (role: string, organizationId?: string) => ({ state: 'authorized', role, user: { uid: 'a', claims: { organizationId } } } as SessionResult & { state: 'authorized' });
beforeEach(() => { fake.count = 0; fake.fail = false; vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-08T10:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });
describe('dashboard snapshot cache', () => {
  it('coalesces concurrent refreshes but separates capabilities and expires in ten seconds', async () => {
    const a = getDashboardOverview(as('super_admin')); const b = getDashboardOverview(as('super_admin'));
    expect(a).toBe(b); expect((await a).metrics[0].value).toBe(1);
    expect((await getDashboardOverview(as('support_agent'))).metrics[0].value).toBe(2);
    vi.advanceTimersByTime(10_001);
    expect((await getDashboardOverview(as('super_admin'))).metrics[0].value).toBe(3);
  });
  it('evicts partial failures so the next authorized request can recover immediately', async () => {
    vi.advanceTimersByTime(60_000); fake.fail = true;
    expect((await getDashboardOverview(as('super_admin'))).metrics[0].value).toBeNull();
    fake.fail = false;
    expect((await getDashboardOverview(as('super_admin'))).metrics[0].value).toBe(2);
  });
  it('separates organizations even when both callers have the same role', async () => {
    expect((await getDashboardOverview(as('organization_admin', 'a'))).metrics[0].value).toBe(1);
    expect((await getDashboardOverview(as('organization_admin', 'b'))).metrics[0].value).toBe(2);
  });
});
