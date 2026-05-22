// Admin payments — server component.
// Phase 17: adds status filter via FilterBar and Export CSV button.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { listPayments } from '@/lib/adminData';
import { PermissionState, EmptyState } from '@/components/state';
import StatusBadge from '@/components/admin/StatusBadge';
import FilterBar from '@/components/admin/FilterBar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CARD   = '#131B27';
const BORDER = '#1A2437';

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams?: { cursor?: string; status?: string };
}) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/points/payments');
  if (!canDo(session.role, 'view:points')) {
    return <div className="p-8"><PermissionState title="Points access required" /></div>;
  }

  const statusFilter = searchParams?.status ?? '';
  const canExport    = canDo(session.role, 'export:points');

  let rows: Awaited<ReturnType<typeof listPayments>> = [];
  let fetchError: string | null = null;
  try { rows = await listPayments(searchParams?.cursor, statusFilter || undefined); }
  catch (e: any) { fetchError = e?.message ?? 'Failed to load payments.'; }

  const nextCursor = rows.length === 50 ? rows[rows.length - 1].id : null;

  function buildExportHref() {
    const p = new URLSearchParams();
    if (statusFilter) p.set('status', statusFilter);
    const qs = p.toString();
    return `/admin/points/payments/export${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="p-6 space-y-5" style={{ color: '#E2E8F2' }}>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-[12px] mb-2">
            <Link href={'/admin/points' as any} className="hover:underline" style={{ color: '#5BB6DE' }}>← Points</Link>
            <span style={{ color: '#475569' }}>/</span>
            <span style={{ color: '#64748B' }}>Payments</span>
          </div>
          <h1 className="text-[22px] font-extrabold tracking-tight">Payments</h1>
          <p className="text-[13px] mt-0.5" style={{ color: '#64748B' }}>Read-only payment records — no refund actions</p>
        </div>
        {canExport && (
          <a
            href={buildExportHref()}
            className="px-4 py-2 text-sm font-bold rounded-lg transition hover:brightness-110"
            style={{ background: '#0A1828', color: '#5BB6DE', border: '1px solid #0E3A5A' }}
          >
            Export CSV
          </a>
        )}
      </div>

      <Suspense>
        <FilterBar
          searchPlaceholder="Search by payment ID in global search (⌘K)"
          filters={[
            { key: 'status', label: 'All statuses', options: [
              { value: 'pending',   label: 'Pending' },
              { value: 'completed', label: 'Completed' },
              { value: 'failed',    label: 'Failed' },
              { value: 'refunded',  label: 'Refunded' },
            ]},
          ]}
        />
      </Suspense>

      {fetchError ? (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: '#2D0D0D', border: '1px solid #3D1515', color: '#EF4444' }}>{fetchError}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl p-12" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <EmptyState title={statusFilter ? 'No payments match the current filter.' : 'No payments yet'} />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {['Payment ID', 'User', 'Points', 'Amount', 'Currency', 'Status', 'Created'].map((h, idx) => (
                  <th
                    key={h}
                    className={`px-4 py-3 text-[10px] font-semibold uppercase tracking-wider ${[2,3].includes(idx) ? 'text-right' : 'text-left'}`}
                    style={{ color: '#475569' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr
                  key={p.id}
                  className="transition hover:bg-white/[0.03]"
                  style={i < rows.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}}
                >
                  <td className="px-4 py-3 font-mono text-[11px]" style={{ color: '#475569' }}>{p.id.slice(0, 12)}…</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${p.userId}` as any} className="font-mono text-[11px] hover:underline" style={{ color: '#5BB6DE' }}>
                      {p.userId.slice(0, 12)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[11px] font-bold" style={{ color: '#22C55E' }}>{p.totalPoints}</td>
                  <td className="px-4 py-3 text-right font-mono text-[11px]" style={{ color: '#94A3B8' }}>{p.amount}</td>
                  <td className="px-4 py-3 font-mono text-[11px]" style={{ color: '#94A3B8' }}>{p.currency}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-3 text-[11px] whitespace-nowrap" style={{ color: '#475569' }}>{p.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <div className="px-4 py-3 text-center" style={{ borderTop: `1px solid ${BORDER}` }}>
              <Link
                href={`/admin/points/payments?cursor=${nextCursor}${statusFilter ? `&status=${statusFilter}` : ''}` as any}
                className="text-sm font-semibold hover:underline"
                style={{ color: '#5BB6DE' }}
              >
                Load more →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
