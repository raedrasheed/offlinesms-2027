// Demo-emulator only. Exercises actual aggregates, pagination, scope and privacy.
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { SessionResult } from '../../apps/dashboard/lib/session';
vi.mock('../../apps/dashboard/lib/firebase-admin', () => ({ adminDb: {} }));
import { loadAnalyticsLive, loadAnalyticsReport } from '../../apps/dashboard/lib/analyticsData';
import { getGeography, loadCountryRegistry } from '../../apps/dashboard/lib/analyticsGeography';
const app = initializeApp({ projectId: 'demo-offlinesms' }, 'analytics-tests');
const db = getFirestore(app), now = new Date('2026-11-08T12:00:00Z');
const ts = (date: string) => Timestamp.fromDate(new Date(date));
const ms = (delta: number) => Timestamp.fromMillis(now.getTime() + delta);
const session = (role = 'super_admin', organizationId?: string) => ({ state: 'authorized', role, user: { uid: 'admin', claims: organizationId ? { organizationId } : {} } } as SessionResult & { state: 'authorized' });
const collections = ['users', 'organizations', 'conversations', 'smsBatches', 'transactions', 'wallets', 'payments', 'tickets', 'clips', 'clipReports', 'statuses', 'communities', 'notificationBroadcasts', 'relayDevices', 'relayJobs'];
const value = (report: Awaited<ReturnType<typeof loadAnalyticsReport>>, section: string, key: string) => report.sections.find(s => s.key === section)?.metrics.find(m => m.key === key)?.value;
beforeAll(() => { if (!process.env.FIRESTORE_EMULATOR_HOST || !db.projectId.startsWith('demo-')) throw Error('Demo emulator required'); });
beforeEach(async () => { await Promise.all(collections.map(c => db.recursiveDelete(db.collection(c)))); });
afterAll(async () => { await db.terminate(); await deleteApp(app); });
async function seed() {
  const batch = db.batch(); const put = (p: string, d: Record<string, unknown>) => batch.set(db.doc(p), d);
  put('users/fresh', { online: true, lastSeen: ms(-10_000), createdAt: ts('2026-11-08T00:00:00Z'), displayName: 'SECRET_NAME', profileCompleted: true });
  put('users/fresh/userPrivate/profile', { phoneNumber: '+970599123456', email: 'SECRET_EMAIL', address: 'SECRET_ADDRESS' });
  put('users/stale', { online: true, lastSeen: ms(-45_001), createdAt: ts('2026-11-02T00:00:00Z') });
  put('users/stale/userPrivate/profile', { phoneNumber: '+14165550123' });
  put('users/offline', { online: false, lastSeen: ms(-1000), createdAt: ts('2026-11-01T23:59:59Z') });
  put('users/future', { online: true, lastSeen: ms(1), createdAt: ts('2026-11-09T00:00:00Z') });
  put('users/noPresence', { phoneNumber: '+442079460018', createdAt: ts('2026-11-04T11:00:00Z') }); // public phone must not be used
  put('users/boundary', { online: true, lastSeen: ms(-45_000), createdAt: ts('2026-11-08T12:00:00Z') });
  put('organizations/org-a', {}); put('organizations/org-b', {});
  for (const uid of ['fresh', 'stale']) put(`organizations/org-a/members/${uid}`, { joinedAt: ts('2026-11-08T10:00:00Z') });
  put('organizations/org-b/members/noPresence', { joinedAt: ts('2026-11-08T10:00:00Z') });
  put('conversations/g-a', { type: 'group', organizationId: 'org-a', createdAt: ts('2026-11-08T10:00:00Z') });
  put('conversations/g-b', { type: 'group', organizationId: 'org-b', createdAt: ts('2026-11-08T10:00:00Z') });
  put('conversations/dm', { type: 'direct', createdAt: ts('2026-11-08T10:00:00Z') });
  for (const [id, type] of [['m1', 'text'], ['m2', 'sticker'], ['m3', 'voice'], ['m4', 'unknown']]) put(`conversations/g-a/messages/${id}`, { type, text: 'SECRET_BODY', createdAt: ts('2026-11-08T00:00:00Z') });
  put('conversations/g-a/messages/old', { type: 'text', createdAt: ts('2026-11-01T23:59:59Z') });
  put('smsBatches/a', { organizationId: 'org-a', status: 'completed', createdAt: ts('2026-11-08T00:00:00Z') });
  put('smsBatches/b', { organizationId: 'org-b', status: 'failed', createdAt: ts('2026-11-08T10:00:00Z') });
  put('smsBatches/c', { organizationId: 'org-a', status: 'queued', createdAt: ts('2026-11-02T00:00:00Z') });
  for (const [id, type, status, amount, date] of [
    ['spend1', 'sms_spend', 'completed', 3.5, '2026-11-08T10:00:00Z'], ['spend2', 'sms_spend', 'completed', 2, '2026-11-02T00:00:00Z'],
    ['reserve', 'reservation', 'completed', 999, '2026-11-08T10:00:00Z'], ['refund', 'refund', 'completed', 999, '2026-11-08T10:00:00Z'],
    ['pending', 'sms_spend', 'pending', 999, '2026-11-08T10:00:00Z'], ['future', 'sms_spend', 'completed', 999, '2026-11-09T00:00:00Z'],
  ] as const) put(`transactions/${id}`, { type, status, amount, createdAt: ts(date), uid: 'SECRET_UID' });
  put('wallets/w1', { balance: 10, reserved: 1 }); put('wallets/w2', { balance: 20 });
  put('clips/published', { status: 'published', viewCount: 100, likeCount: 5, commentCount: 2, createdAt: ts('2026-11-08T10:00:00Z') });
  put('clips/review', { status: 'pending_review', viewCount: 9000, createdAt: ts('2026-11-03T10:00:00Z') });
  put('statuses/new', { type: 'text', createdAt: ts('2026-11-08T10:00:00Z'), expiresAt: ts('2026-11-09T10:00:00Z') });
  put('tickets/open', { status: 'open' }); put('tickets/closed', { status: 'closed' });
  put('relayDevices/live', { businessId: 'org-a', status: 'active', lastHeartbeatAt: ms(-10_000) });
  put('relayDevices/stale', { businessId: 'org-b', status: 'active', lastHeartbeatAt: ms(-90_001) });
  put('relayJobs/queued-a', { businessId: 'org-a', status: 'queued' }); put('relayJobs/queued-b', { businessId: 'org-b', status: 'queued' });
  put('relayJobs/sending-a', { businessId: 'org-a', status: 'sending' });
  await batch.commit();
}
describe('comprehensive analytics against Firestore', () => {
  it('counts stored entities, exact UTC chart boundaries and actual settled points; serializes no private content', async () => {
    await seed(); const report = await loadAnalyticsReport(db, session(), '7d', now);
    expect(report.issues).toEqual([]); expect(value(report, 'users', 'users')).toBe(6); expect(value(report, 'users', 'newUsers')).toBe(4);
    expect(value(report, 'groups', 'groups')).toBe(2); expect(value(report, 'groups', 'conversations')).toBe(3);
    expect(value(report, 'messages', 'messages')).toBe(4); expect(value(report, 'sms', 'batches')).toBe(3); expect(value(report, 'sms', 'failed')).toBe(1);
    expect(value(report, 'points', 'points')).toBe(5.5); expect(value(report, 'points', 'balance')).toBe(30); expect(value(report, 'points', 'reserved')).toBe(1);
    expect(value(report, 'clips', 'viewCount')).toBe(100); expect(value(report, 'clips', 'pending')).toBe(1); expect(value(report, 'stories', 'unexpired')).toBe(1);
    const users = report.sections.find(s => s.key === 'users')!;
    expect(users.trend!.points.map(p => p.value)).toEqual([1, 0, 1, 0, 0, 0, 2]); // boundary at now included once
    const types = report.sections.find(s => s.key === 'messages')!.breakdown!.rows;
    expect(types.find(t => t.name === 'Audio')!.value).toBe(1); expect(types.at(-1)!.value).toBe(1);
    expect(report.sections.find(s => s.key === 'points')!.trend!.points.map(p => p.value)).toEqual([2, 0, 0, 0, 0, 0, 3.5]);
    expect(JSON.stringify(report)).not.toMatch(/SECRET_|\+970|\+1416/);
  });
  it('excludes stale, future and offline flags from online; maps countries privately with explicit unknowns', async () => {
    await seed(); const live = await loadAnalyticsLive(db, session(), now);
    expect(live.issues).toEqual([]); expect(live.online).toBe(2); expect(live.active24h).toBe(4); expect(live.active7d).toBe(4); expect(live.presenceCoverage).toBe(4);
    expect(live.relayOnline).toBe(1); expect(live.relayQueued).toBe(2); expect(live.relayInFlight).toBe(1);
    expect(live.geography?.total).toBe(6); expect(live.geography?.unknown).toBe(4); expect(live.geography?.onlineUnknown).toBe(1);
    expect(live.geography?.countries.find(c => c.iso === 'PS')).toMatchObject({ registered: 1, online: 1, active24h: 1 });
    expect(live.geography?.countries.find(c => c.iso === 'CA')).toMatchObject({ registered: 1, online: 0 });
    expect(live.geography?.countries.find(c => c.iso === 'GB')).toBeUndefined();
    expect(JSON.stringify(live)).not.toMatch(/SECRET_|\+970|\+1416|fresh|boundary/);
  });
  it('scopes organization membership, SMS, groups and relays and does not query global users/media/messages/finance', async () => {
    await seed(); const calls: string[] = [];
    const traced = new Proxy(db, { get(target, prop) { const member = (target as any)[prop];
      if (prop === 'collection' || prop === 'collectionGroup') return (name: string) => { calls.push(name); return member.call(target, name); };
      return typeof member === 'function' ? member.bind(target) : member;
    } });
    const s = session('organization_admin', 'org-a'), report = await loadAnalyticsReport(traced, s, '7d', now), live = await loadAnalyticsLive(traced, s, now);
    expect(report.issues).toEqual([]); expect(value(report, 'users', 'users')).toBe(2); expect(value(report, 'users', 'newUsers')).toBe(2);
    expect(value(report, 'groups', 'groups')).toBe(1); expect(value(report, 'sms', 'batches')).toBe(2); expect(value(report, 'sms', 'failed')).toBe(0);
    expect(live.showUsers).toBe(false); expect(live.geography).toBeNull(); expect(live.relayQueued).toBe(1);
    for (const c of ['users', 'messages', 'clips', 'statuses', 'transactions', 'wallets', 'payments', 'tickets', 'communities']) expect(calls).not.toContain(c);
    expect(report.sections.map(s => s.key)).not.toContain('points');
    await expect(loadAnalyticsReport(db, session('organization_admin'), '7d', now)).rejects.toThrow('organizationId');
  });
  it('gates sensitive sections and presence by role, with no hidden data in the payload', async () => {
    await seed(); const s = session('finance_admin'), report = await loadAnalyticsReport(db, s, '7d', now), live = await loadAnalyticsLive(db, s, now);
    expect(report.sections.map(s => s.key)).toEqual(['sms', 'points']); expect(live.geography).toBeNull(); expect(live.showUsers).toBe(false);
    await expect(loadAnalyticsReport(db, session('support_agent'), '7d', now)).rejects.toThrow('Reports access');
    const ambiguous = session('legacy_admin'); ambiguous.user.claims = { admin: true, role: 'organization_admin', organizationId: 'org-a' };
    await expect(loadAnalyticsReport(db, ambiguous, '7d', now)).rejects.toThrow('Ambiguous');
  });
  it('shows unavailable, never false zero, if a query source fails', async () => {
    // Simulate an aggregate failure rather than invalidating construction.
    const aggFailure = new Proxy(db, { get(target, prop) { if (prop === 'collection') return (name: string) => name === 'wallets' ? { aggregate: () => ({ get: async () => { throw Error('PRIVATE_ERROR'); } }) } : target.collection(name); const m = (target as any)[prop]; return typeof m === 'function' ? m.bind(target) : m; } });
    const report = await loadAnalyticsReport(aggFailure as Firestore, session('finance_admin'), '7d', now);
    expect(value(report, 'points', 'balance')).toBeNull(); expect(value(report, 'points', 'reserved')).toBeNull(); expect(report.issues).toContain('Wallet balances'); expect(JSON.stringify(report)).not.toContain('PRIVATE_ERROR');
  });
  it('paginates the complete country directory beyond 500 users and does not turn fresh registrations into false country matches', async () => {
    for (let offset = 0; offset < 505; offset += 200) {
      const batch = db.batch();
      for (let i = offset; i < Math.min(offset + 200, 505); i++) { const uid = `user${String(i).padStart(4, '0')}`; batch.set(db.doc(`users/${uid}`), { lastSeen: ms(-1000) }); batch.set(db.doc(`users/${uid}/userPrivate/profile`), { phoneNumber: '+970599123456' }); }
      await batch.commit();
    }
    const registry = await loadCountryRegistry(db, now.getTime()); expect(registry.users.size).toBe(505);
    // Independent Firestore object avoids sharing the deliberately cached small fixture directory.
    const other = initializeApp({ projectId: 'demo-offlinesms' }, 'analytics-pagination'); const pagedDb = getFirestore(other);
    try {
      const geo = await getGeography(pagedDb, now, ['user0000', 'not-yet-in-directory']);
      expect(geo.total).toBe(505); expect(geo.unknown).toBe(0); expect(geo.onlineUnknown).toBe(1); expect(geo.countries).toHaveLength(1); expect(geo.countries[0]).toMatchObject({ registered: 505, online: 1 });
    } finally { await pagedDb.terminate(); await deleteApp(other); }
  });
});
