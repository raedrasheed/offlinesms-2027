import { AggregateField, Timestamp, type Firestore, type Query } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { canDo } from './adminPermissions';
import { getAdminScope, type AdminScope } from './adminScope';
import type { SessionResult } from './session';
import { dashboardDays, finiteNumber, type DashboardOverview } from './dashboardOverview';

type Authorized = SessionResult & { state: 'authorized' };
const CACHE_MS = 10_000;
const MAX_CACHE_ENTRIES = 100;
const cache = new Map<string, { expiresAt: number; promise: Promise<DashboardOverview> }>();

/** Called only after session verification, on both the page and JSON route.
 * Scope and capabilities are derived from verified claims, never request params.
 * Short per-role/per-org caching coalesces polling tabs without sharing scopes. */
export function getDashboardOverview(session: Authorized): Promise<DashboardOverview> {
  if (!canDo(session.role, 'view:overview')) throw new Error('Overview access required');
  const scope = getAdminScope(session);
  const key = JSON.stringify([session.role, scope.organizationId ?? null]);
  const now = Date.now();
  for (const [k, entry] of cache) if (entry.expiresAt <= now) cache.delete(k);
  const existing = cache.get(key);
  if (existing) return existing.promise;
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  const promise = loadDashboardOverview(adminDb, session, scope, new Date(now));
  const entry = { expiresAt: now + CACHE_MS, promise };
  cache.set(key, entry);
  void promise.then(result => {
    // Query failures must recover on the next request, not remain cached as zero.
    if (result.issues.length && cache.get(key) === entry) cache.delete(key);
  }, () => { if (cache.get(key) === entry) cache.delete(key); });
  return promise;
}

// Explicit db/clock make the actual Firestore queries testable in the emulator.
export async function loadDashboardOverview(db: Firestore, session: Authorized, scope: AdminScope, now: Date): Promise<DashboardOverview> {
  const issues = new Set<string>();
  const days = dashboardDays(now);
  const out: DashboardOverview = {
    generatedAt: now.toISOString(), scope: scope.organizationId ? 'Organization' : 'Platform',
    metrics: [], smsTrend: null, batchStatuses: null, pointsTrend: null, recentBatches: null, relay: null, issues: [],
  };
  const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try { return await fn(); }
    catch { issues.add(label); return null; }
  };
  const scoped = (collection: string, orgField = 'organizationId'): Query => {
    const q = db.collection(collection);
    return scope.organizationId ? q.where(orgField, '==', scope.organizationId) : q;
  };
  const count = (label: string, q: Query) => safe(label, async () => (await q.count().get()).data().count);
  const between = (q: Query, start: Date, end: Date) => q
    .where('createdAt', '>=', Timestamp.fromDate(start)).where('createdAt', '<', Timestamp.fromDate(end));
  const metric = async (key: string, label: string, note: string, q: Query) => {
    const m = { key, label, value: null as number | null, note };
    out.metrics.push(m);
    m.value = await count(label, q);
  };
  const jobs: Promise<unknown>[] = [];
  if (canDo(session.role, 'view:users')) {
    jobs.push(metric('users', scope.organizationId ? 'Organization members' : 'Total users', 'Current total',
      scope.organizationId ? db.collection('organizations').doc(scope.organizationId).collection('members') : db.collection('users')));
  }
  if (canDo(session.role, 'view:groups')) {
    jobs.push(metric('groups', 'Groups', 'Current total', scoped('conversations').where('type', '==', 'group')));
  }
  if (canDo(session.role, 'view:sms')) {
    const batches = scoped('smsBatches');
    const week = between(batches, days[0].start, now);
    jobs.push(metric('smsToday', 'SMS batches today', 'Since 00:00 UTC', between(batches, days[6].start, now)));
    jobs.push(metric('failedBatches', 'Failed SMS batches', '7 calendar days · UTC', week.where('status', '==', 'failed')));
    jobs.push((async () => {
      out.smsTrend = await Promise.all(days.map(async d => ({ date: d.date, label: d.label, value: await count('SMS trend', between(batches, d.start, d.end)) })));
    })());
    jobs.push((async () => {
      const groups = [
        { name: 'Completed / accepted', statuses: ['completed', 'accepted'], color: '#22C55E' },
        { name: 'In progress', statuses: ['sending', 'queued', 'pending', 'processing'], color: '#EAB308' },
        { name: 'Partial', statuses: ['partial'], color: '#F97316' },
        { name: 'Failed', statuses: ['failed'], color: '#EF4444' },
      ];
      const [total, values] = await Promise.all([
        count('SMS batch status', week),
        Promise.all(groups.map(g => count('SMS batch status', week.where('status', 'in', g.statuses)))),
      ]);
      const known = values.every(v => v !== null) && total !== null;
      out.batchStatuses = groups.map((g, i) => ({ name: g.name, value: values[i], color: g.color }));
      out.batchStatuses.push({ name: 'Other', value: known ? Math.max(0, total! - values.reduce<number>((n, v) => n + (v ?? 0), 0)) : null, color: '#64748B' });
    })());
    jobs.push((async () => {
      out.recentBatches = await safe('Recent SMS batches', async () => {
        const snapshot = await batches.orderBy('createdAt', 'desc').limit(6)
          .select('status', 'totalCount', 'recipientCount', 'pointsDeducted', 'createdAt').get();
        return snapshot.docs.map(doc => {
          const d = doc.data();
          return {
            id: doc.id, status: typeof d.status === 'string' ? d.status : 'unknown',
            recipients: finiteNumber(d.totalCount) ?? finiteNumber(d.recipientCount),
            ...(canDo(session.role, 'view:points') ? { billedPoints: finiteNumber(d.pointsDeducted) } : {}),
            createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toDate().toISOString() : null,
          };
        });
      });
    })());
  }
  if (canDo(session.role, 'view:points')) {
    // Settlement writes sms_spend for the billed amount after refunds, not the
    // reservation or estimate. Sum amounts, never transaction/wallet counts.
    const spend = scoped('transactions').where('type', '==', 'sms_spend').where('status', '==', 'completed');
    const m = { key: 'points', label: 'SMS points spent', value: null as number | null, note: 'Settled charges · 7 calendar days · UTC' };
    out.metrics.push(m);
    jobs.push((async () => {
      out.pointsTrend = await Promise.all(days.map(async d => ({
        date: d.date, label: d.label,
        value: await safe('Points usage', async () => {
          const s = await between(spend, d.start, d.end).aggregate({ amount: AggregateField.sum('amount') }).get();
          const amount = finiteNumber(s.data().amount);
          if (amount === null) throw new Error('Invalid points aggregate');
          return amount;
        }),
      })));
      m.value = out.pointsTrend.some(d => d.value === null) ? null : out.pointsTrend.reduce((n, d) => n + d.value!, 0);
    })());
  }
  // Legacy tickets have no canonical organization field. Do not imply an org
  // has no tickets by filtering a field its tickets never stored.
  if (canDo(session.role, 'view:support') && !scope.organizationId) {
    jobs.push(metric('tickets', 'Open support tickets', 'Open and pending', scoped('tickets').where('status', 'in', ['open', 'pending'])));
  }
  if (canDo(session.role, 'view:relay')) {
    jobs.push((async () => {
      const devices = scoped('relayDevices', 'businessId');
      const relayJobs = scoped('relayJobs', 'businessId');
      const [queued, inFlight, online, total] = await Promise.all([
        count('Relay queue', relayJobs.where('status', '==', 'queued')),
        count('Relay in flight', relayJobs.where('status', 'in', ['claimed', 'sending'])),
        count('Online relay devices', devices.where('status', '==', 'active')
          .where('lastHeartbeatAt', '>', Timestamp.fromMillis(now.getTime() - 90_000))
          .where('lastHeartbeatAt', '<=', Timestamp.fromDate(now))),
        count('Relay devices', devices),
      ]);
      out.relay = { queued, inFlight, online, total };
    })());
  }
  await Promise.all(jobs);
  out.issues = [...issues].sort();
  return out;
}
