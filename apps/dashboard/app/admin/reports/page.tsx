// Admin reports foundation — server component.
// Safe aggregate counts and 7-day trend tables.
// No private content, no message bodies, no full phone numbers.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { PermissionState } from '@/components/state';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type DayCount = { label: string; count: number | null };

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
}

async function safeCount(fn: () => Promise<number>): Promise<number | null> {
  try { return await fn(); } catch { return null; }
}

async function getLast7DayCounts(
  collection: string,
  dateField: string,
  extraWhere?: { field: string; op: FirebaseFirestore.WhereFilterOp; value: unknown },
): Promise<DayCount[]> {
  const results: DayCount[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const dayStart = startOfDay(new Date(now.getTime() - i * 86_400_000));
    const dayEnd   = new Date(dayStart.getTime() + 86_400_000);
    const count = await safeCount(async () => {
      let q = adminDb.collection(collection)
        .where(dateField, '>=', Timestamp.fromDate(dayStart))
        .where(dateField, '<',  Timestamp.fromDate(dayEnd)) as FirebaseFirestore.Query;
      if (extraWhere) q = q.where(extraWhere.field, extraWhere.op, extraWhere.value);
      const snap = await q.count().get();
      return snap.data().count;
    });
    results.push({ label: dayLabel(dayStart), count });
  }
  return results;
}

function fmt(n: number | null): string {
  if (n === null) return '—';
  return n.toLocaleString('en-US');
}

function TrendTable({ rows, title }: { rows: DayCount[]; title: string }) {
  const max = rows.reduce((m, r) => Math.max(m, r.count ?? 0), 1);
  return (
    <div className="bg-white rounded-2xl border border-ink-100 shadow-sh1 p-5">
      <h2 className="text-sm font-extrabold text-ink-900 mb-3">{title}</h2>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-left text-[10px] font-bold text-ink-500 uppercase tracking-wide">
            <th className="pb-2">Day</th>
            <th className="pb-2 text-right">Count</th>
            <th className="pb-2 pl-3">Bar</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.label} className="border-t border-ink-50">
              <td className="py-1.5 font-mono text-ink-600">{r.label}</td>
              <td className="py-1.5 text-right font-mono font-bold text-ink-900">{fmt(r.count)}</td>
              <td className="py-1.5 pl-3">
                <div className="h-2 rounded-full bg-primary/20 overflow-hidden w-full max-w-[120px]">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: r.count !== null ? `${Math.round((r.count / max) * 100)}%` : '0%' }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ReportsPage() {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/reports');
  if (!canDo(session.role, 'view:reports')) {
    return (
      <div className="p-8">
        <PermissionState title="Reports access required" description="Your role does not include access to reports." />
      </div>
    );
  }

  const now     = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  const weekTs  = Timestamp.fromDate(startOfDay(weekAgo));
  const monthTs = Timestamp.fromDate(startOfDay(monthAgo));

  const [
    totalUsers, usersThisWeek, usersThisMonth,
    activeGroups,
    smsBatchesThisWeek, failedSmsBatchesThisWeek,
    pointsSpentThisWeek,
    openTickets, ticketsPending, ticketsResolved, ticketsClosed,
  ] = await Promise.all([
    safeCount(() => adminDb.collection('users').count().get().then(s => s.data().count)),
    safeCount(() => adminDb.collection('users').where('createdAt', '>=', weekTs).count().get().then(s => s.data().count)),
    safeCount(() => adminDb.collection('users').where('createdAt', '>=', monthTs).count().get().then(s => s.data().count)),
    safeCount(() => adminDb.collection('conversations').where('type', '==', 'group').where('status', '==', 'active').count().get().then(s => s.data().count)),
    safeCount(() => adminDb.collection('smsBatches').where('createdAt', '>=', weekTs).count().get().then(s => s.data().count)),
    safeCount(() => adminDb.collection('smsBatches').where('status', '==', 'failed').where('createdAt', '>=', weekTs).count().get().then(s => s.data().count)),
    safeCount(() => adminDb.collection('transactions').where('type', '==', 'spend').where('createdAt', '>=', weekTs).count().get().then(s => s.data().count)),
    safeCount(() => adminDb.collection('tickets').where('status', '==', 'open').count().get().then(s => s.data().count)),
    safeCount(() => adminDb.collection('tickets').where('status', '==', 'pending').count().get().then(s => s.data().count)),
    safeCount(() => adminDb.collection('tickets').where('status', '==', 'resolved').count().get().then(s => s.data().count)),
    safeCount(() => adminDb.collection('tickets').where('status', '==', 'closed').count().get().then(s => s.data().count)),
  ]);

  const [smsTrend, userTrend] = await Promise.all([
    getLast7DayCounts('smsBatches', 'createdAt'),
    getLast7DayCounts('users', 'createdAt'),
  ]);

  const overviewCards = [
    { label: 'Total users',          value: fmt(totalUsers),               note: 'All time',    warn: false },
    { label: 'New users this week',   value: fmt(usersThisWeek),            note: 'Last 7 days', warn: false },
    { label: 'New users this month',  value: fmt(usersThisMonth),           note: 'Last 30 days', warn: false },
    { label: 'Active groups',         value: fmt(activeGroups),             note: 'Current',     warn: false },
    { label: 'SMS batches this week', value: fmt(smsBatchesThisWeek),       note: 'Last 7 days', warn: false },
    { label: 'Failed SMS this week',  value: fmt(failedSmsBatchesThisWeek), note: 'Last 7 days', warn: (failedSmsBatchesThisWeek ?? 0) > 0 },
    { label: 'Point-spend txns/week', value: fmt(pointsSpentThisWeek),      note: 'Last 7 days', warn: false },
    { label: 'Open support tickets',  value: fmt(openTickets),              note: 'Current',     warn: (openTickets ?? 0) > 0 },
  ];

  const ticketStatusRows = [
    { label: 'Open',     count: openTickets },
    { label: 'Pending',  count: ticketsPending },
    { label: 'Resolved', count: ticketsResolved },
    { label: 'Closed',   count: ticketsClosed },
  ];

  return (
    <div className="p-7">
      <div className="mb-6">
        <h1 className="text-xl font-extrabold tracking-tight text-ink-900">Reports</h1>
        <p className="text-sm text-ink-500 mt-0.5">Safe aggregate counts. No private content. Counts may be slightly delayed.</p>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {overviewCards.map(c => (
          <div key={c.label} className="bg-white rounded-2xl border border-ink-100 shadow-sh1 p-4">
            <div className="text-[10px] font-bold text-ink-500 uppercase tracking-wide mb-1">{c.label}</div>
            <div className={`font-mono text-2xl font-extrabold ${c.warn ? 'text-amber-600' : 'text-ink-900'}`}>{c.value}</div>
            <div className="text-[10px] text-ink-400 mt-0.5">{c.note}</div>
          </div>
        ))}
      </div>

      {/* 7-day trend tables */}
      <div className="grid md:grid-cols-2 gap-5 mb-8">
        <TrendTable rows={smsTrend}  title="SMS batches — last 7 days" />
        <TrendTable rows={userTrend} title="New users — last 7 days" />
      </div>

      {/* Support tickets by status */}
      <div className="bg-white rounded-2xl border border-ink-100 shadow-sh1 p-5 mb-5">
        <h2 className="text-sm font-extrabold text-ink-900 mb-4">Support tickets by status</h2>
        <div className="grid grid-cols-4 gap-4">
          {ticketStatusRows.map(r => (
            <div key={r.label} className="text-center">
              <div className="font-mono text-2xl font-extrabold text-ink-900">{fmt(r.count)}</div>
              <div className="text-xs text-ink-500 mt-1 capitalize">{r.label}</div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-ink-400 mt-4">
        All counts use Firestore aggregation queries. No message content, SMS body, or personal data is included.
      </p>
    </div>
  );
}
