// Real aggregation queries against the demo Firestore emulator. No production
// credentials, message sends, triggers or writes to production are used.
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { SessionResult } from '../../apps/dashboard/lib/session';
const state = vi.hoisted(() => ({ db: null as Firestore | null }));
vi.mock('../../apps/dashboard/lib/firebase-admin', () => ({ adminDb: new Proxy({}, {
  get: (_, prop) => { const value = (state.db as any)[prop]; return typeof value === 'function' ? value.bind(state.db) : value; },
}) }));
import { getDashboardOverview, loadDashboardOverview } from '../../apps/dashboard/lib/dashboardData';
import { getAdminScope } from '../../apps/dashboard/lib/adminScope';

const app = initializeApp({ projectId: 'demo-offlinesms' }, 'dashboard-overview-tests');
const db = getFirestore(app);
const now = new Date('2026-11-08T12:34:56.000Z');
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const session = (role = 'super_admin', organizationId?: string) => ({
  state: 'authorized', role, user: { uid: 'dashboard-admin', claims: organizationId ? { organizationId } : {} },
} as SessionResult & { state: 'authorized' });
const metric = (data: Awaited<ReturnType<typeof loadDashboardOverview>>, key: string) => data.metrics.find(m => m.key === key)?.value;
const load = (s = session()) => loadDashboardOverview(db, s, getAdminScope(s), now);
const collections = ['users', 'organizations', 'conversations', 'smsBatches', 'transactions', 'tickets', 'relayDevices', 'relayJobs'];

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !db.projectId.startsWith('demo-')) throw new Error('Demo emulator required');
  state.db = db;
});
beforeEach(async () => { await Promise.all(collections.map(c => db.recursiveDelete(db.collection(c)))); });
afterAll(async () => { await db.terminate(); await deleteApp(app); });

async function seed() {
  const batch = db.batch();
  const put = (path: string, data: Record<string, unknown>) => batch.set(db.doc(path), data);
  for (const uid of ['u1', 'u2', 'u3']) put(`users/${uid}`, { displayName: uid, phone: 'private' });
  for (const uid of ['u1', 'u2']) put(`organizations/org-a/members/${uid}`, {});
  put('organizations/org-b/members/u3', {});
  put('conversations/a1', { type: 'group', organizationId: 'org-a' });
  put('conversations/a2', { type: 'group', organizationId: 'org-a', status: 'active' });
  put('conversations/b1', { type: 'group', organizationId: 'org-b' });
  put('conversations/dm', { type: 'direct' });
  put('smsBatches/first', { status: 'completed', organizationId: 'org-a', totalCount: 10, pointsDeducted: 7, createdAt: ts('2026-11-02T00:00:00Z'), smsBody: 'private text', phone: 'private' });
  put('smsBatches/today-a', { status: 'sending', organizationId: 'org-a', recipientCount: 4, createdAt: ts('2026-11-08T00:00:00Z') });
  put('smsBatches/today-b', { status: 'failed', organizationId: 'org-b', totalCount: 2, pointsDeducted: 0, createdAt: ts('2026-11-08T01:00:00Z') });
  put('smsBatches/partial-a', { status: 'partial', organizationId: 'org-a', createdAt: ts('2026-11-07T22:00:00Z') });
  put('smsBatches/old', { status: 'failed', organizationId: 'org-a', createdAt: ts('2026-11-01T23:59:59Z') });
  for (const [id, type, status, amount, date] of [
    ['s1', 'sms_spend', 'completed', 11, '2026-11-08T10:00:00Z'],
    ['s2', 'sms_spend', 'completed', 7, '2026-11-02T00:00:00Z'],
    ['reserve', 'reservation', 'completed', 999, '2026-11-08T10:00:00Z'],
    ['refund', 'refund', 'completed', 555, '2026-11-08T10:00:00Z'],
    ['pending', 'sms_spend', 'pending', 300, '2026-11-08T10:00:00Z'],
    ['transfer', 'transfer', 'completed', 800, '2026-11-08T10:00:00Z'],
    ['old', 'sms_spend', 'completed', 500, '2026-11-01T23:59:59Z'],
    ['future', 'sms_spend', 'completed', 600, '2026-11-09T00:00:00Z'],
  ] as const) put(`transactions/${id}`, { type, status, amount, createdAt: ts(date) });
  put('tickets/open', { status: 'open' }); put('tickets/pending', { status: 'pending' }); put('tickets/closed', { status: 'resolved' });
  put('relayDevices/live', { businessId: 'org-a', status: 'active', lastHeartbeatAt: Timestamp.fromMillis(now.getTime() - 10_000) });
  put('relayDevices/stale', { businessId: 'org-a', status: 'active', lastHeartbeatAt: Timestamp.fromMillis(now.getTime() - 90_001) });
  put('relayDevices/revoked', { businessId: 'org-b', status: 'revoked', lastHeartbeatAt: Timestamp.fromDate(now) });
  put('relayDevices/future', { businessId: 'org-b', status: 'active', lastHeartbeatAt: Timestamp.fromMillis(now.getTime() + 5_000) });
  put('relayJobs/a1', { businessId: 'org-a', status: 'queued' }); put('relayJobs/a2', { businessId: 'org-a', status: 'sending' });
  put('relayJobs/b1', { businessId: 'org-b', status: 'queued' }); put('relayJobs/b2', { businessId: 'org-b', status: 'sent' });
  await batch.commit();
}

describe('live dashboard data', () => {
  it('uses exact aggregates and settled amounts, with UTC boundaries and newest-first rows', async () => {
    await seed(); const result = await load();
    expect(result.issues).toEqual([]);
    expect(metric(result, 'users')).toBe(3); expect(metric(result, 'groups')).toBe(3);
    expect(metric(result, 'smsToday')).toBe(2); expect(metric(result, 'failedBatches')).toBe(1);
    expect(metric(result, 'tickets')).toBe(2); expect(metric(result, 'points')).toBe(18);
    expect(result.smsTrend?.map(d => d.value)).toEqual([1, 0, 0, 0, 0, 1, 2]);
    expect(result.pointsTrend?.map(d => d.value)).toEqual([7, 0, 0, 0, 0, 0, 11]);
    expect(result.batchStatuses?.map(d => d.value)).toEqual([1, 1, 1, 1, 0]);
    expect(result.relay).toEqual({ queued: 2, inFlight: 1, online: 1, total: 4 });
    expect(result.recentBatches?.map(d => d.id)).toEqual(['today-b', 'today-a', 'partial-a', 'first', 'old']);
    expect(result.recentBatches?.[1].recipients).toBe(4);
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('scopes every org aggregate/list and never reads other organizations or platform finance', async () => {
    await seed(); const result = await load(session('organization_admin', 'org-a'));
    expect(result.issues).toEqual([]);
    expect(metric(result, 'users')).toBe(2); expect(metric(result, 'groups')).toBe(2);
    expect(metric(result, 'smsToday')).toBe(1); expect(metric(result, 'failedBatches')).toBe(0);
    expect(result.recentBatches?.every(b => !('billedPoints' in b))).toBe(true);
    expect(result.recentBatches?.map(b => b.id)).not.toContain('today-b');
    expect(result.relay).toEqual({ queued: 1, inFlight: 1, online: 1, total: 2 });
    expect(result.pointsTrend).toBeNull(); expect(metric(result, 'tickets')).toBeUndefined();
  });
  it('omits data for capabilities the role does not have, including serialized hidden data', async () => {
    await seed(); const support = await load(session('support_agent'));
    expect(support.pointsTrend).toBeNull(); expect(support.relay).toBeNull();
    expect(metric(support, 'groups')).toBeUndefined(); expect(metric(support, 'points')).toBeUndefined();
    expect(support.recentBatches?.every(b => !('billedPoints' in b))).toBe(true);
    const finance = await load(session('finance_admin'));
    expect(metric(finance, 'users')).toBeUndefined(); expect(metric(finance, 'tickets')).toBeUndefined();
    expect(finance.relay).toBeNull(); expect(metric(finance, 'points')).toBe(18);
  });
  it('represents a successfully empty database as zero/empty, not an error', async () => {
    const result = await load();
    expect(result.issues).toEqual([]); expect(result.metrics.every(m => m.value === 0)).toBe(true);
    expect(result.recentBatches).toEqual([]); expect(result.smsTrend?.every(d => d.value === 0)).toBe(true);
  });
  it('returns unavailable on a failed section without replacing other real data with zero', async () => {
    await seed();
    const query = db.collection('users');
    const brokenDb = new Proxy(db, { get(target, prop) {
      if (prop === 'collection') return (name: string) => name === 'users' ? new Proxy(query, { get(q, field) {
        if (field === 'count') return () => ({ get: async () => { throw new Error('denied'); } });
        const value = (q as any)[field]; return typeof value === 'function' ? value.bind(q) : value;
      } }) : db.collection(name);
      return (target as any)[prop];
    } });
    const result = await loadDashboardOverview(brokenDb, session(), { organizationId: undefined }, now);
    expect(result.issues).toContain('Total users'); expect(metric(result, 'users')).toBeNull();
    expect(metric(result, 'points')).toBe(18); expect(metric(result, 'smsToday')).toBe(2);
  });
  it('caps document reads to six recent batches without capping aggregate totals', async () => {
    const batch = db.batch();
    for (let i = 0; i < 30; i++) batch.set(db.collection('smsBatches').doc(`batch-${i}`), { status: 'accepted', createdAt: Timestamp.fromMillis(now.getTime() - (i + 1) * 1000) });
    await batch.commit(); const result = await load();
    expect(metric(result, 'smsToday')).toBe(30); expect(result.recentBatches).toHaveLength(6);
    expect(result.batchStatuses?.[0].value).toBe(30);
  });
  it('does not manufacture zero spending if the financial aggregate is non-finite', async () => {
    await db.collection('transactions').doc('invalid-numeric').set({ type: 'sms_spend', status: 'completed', amount: Number.NaN, createdAt: Timestamp.fromDate(new Date(now.getTime() - 1000)) });
    const result = await load();
    expect(metric(result, 'points')).toBeNull(); expect(result.issues).toContain('Points usage');
  });
  it('rejects org admins missing a scope before any cached platform response', () => {
    expect(() => getDashboardOverview(session('organization_admin'))).toThrow('organizationId');
  });
});
