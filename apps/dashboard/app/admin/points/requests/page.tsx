// Admin points requests — server component.
//
// Users request a points package (no payment); admins approve (credits the
// wallet with the requested points via an admin_adjustment) or reject.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { listPointsRequests } from '@/lib/adminData';
import { PermissionState, EmptyState } from '@/components/state';
import StatusBadge from '@/components/admin/StatusBadge';
import UserName from '@/components/admin/UserName';
import { resolveUserNames } from '@/lib/userNames';
import FilterBar from '@/components/admin/FilterBar';
import RequestActions from './RequestActions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CARD   = 'var(--c-card)';
const BORDER = 'var(--c-border)';

export default async function PointsRequestsPage({
  searchParams,
}: {
  searchParams?: { cursor?: string; status?: string };
}) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/points/requests');
  if (!canDo(session.role, 'view:points')) {
    return <div className="p-8"><PermissionState title="Points access required" /></div>;
  }

  const statusFilter = searchParams?.status ?? '';
  const canManage    = canDo(session.role, 'manage:wallets');

  let rows: Awaited<ReturnType<typeof listPointsRequests>> = [];
  let fetchError: string | null = null;
  try { rows = await listPointsRequests(searchParams?.cursor, statusFilter || undefined); }
  catch (e: any) { fetchError = e?.message ?? 'Failed to load requests.'; }
  const names = await resolveUserNames(rows.map(r => r.userId));

  const nextCursor = rows.length === 50 ? rows[rows.length - 1].id : null;

  return (
    <div className="p-6 space-y-5" style={{ color: 'var(--c-text)' }}>
      <div>
        <div className="flex items-center gap-2 text-[12px] mb-2">
          <Link href={'/admin/points' as any} className="hover:underline" style={{ color: '#5BB6DE' }}>← Points</Link>
          <span style={{ color: 'var(--c-text-4)' }}>/</span>
          <span style={{ color: 'var(--c-text-3)' }}>Requests</span>
        </div>
        <h1 className="text-[22px] font-extrabold tracking-tight">Points requests</h1>
        <p className="text-[13px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>
          Users request a package (no payment). Approving credits the wallet with the requested points.
        </p>
      </div>

      <Suspense>
        <FilterBar
          searchPlaceholder="Search by request ID in global search (⌘K)"
          filters={[
            { key: 'status', label: 'All statuses', options: [
              { value: 'pending',  label: 'Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
            ]},
          ]}
        />
      </Suspense>

      {fetchError ? (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--c-error-bg)', border: '1px solid var(--c-error-border)', color: '#EF4444' }}>{fetchError}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl p-12" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <EmptyState title={statusFilter ? 'No requests match the current filter.' : 'No points requests yet'} />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {['Request ID', 'User', 'Package', 'Points', 'Status', 'Created', ...(canManage ? ['Actions'] : [])].map((h, idx) => (
                  <th
                    key={h}
                    className={`px-4 py-3 text-[10px] font-semibold uppercase tracking-wider ${idx === 3 ? 'text-right' : h === 'Actions' ? 'text-right' : 'text-left'}`}
                    style={{ color: 'var(--c-text-4)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.id}
                  className="transition hover:bg-white/[0.03]"
                  style={i < rows.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}}
                >
                  <td className="px-4 py-3 font-mono text-[11px]" style={{ color: 'var(--c-text-4)' }}>{r.id.slice(0, 12)}…</td>
                  <td className="px-4 py-3">
                    <UserName uid={r.userId} info={names[r.userId]} color="#5BB6DE" />
                  </td>
                  <td className="px-4 py-3 text-[11px]" style={{ color: 'var(--c-text-2)' }}>{r.packageName || '—'}</td>
                  <td className="px-4 py-3 text-right font-mono text-[11px] font-bold" style={{ color: '#22C55E' }}>{r.points.toLocaleString()}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-[11px] whitespace-nowrap" style={{ color: 'var(--c-text-4)' }}>{r.createdAt}</td>
                  {canManage && (
                    <td className="px-4 py-3">
                      {r.status === 'pending'
                        ? <RequestActions requestId={r.id} />
                        : <span className="text-[11px]" style={{ color: 'var(--c-text-4)' }}>—</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <div className="px-4 py-3 text-center" style={{ borderTop: `1px solid ${BORDER}` }}>
              <Link
                href={`/admin/points/requests?cursor=${nextCursor}${statusFilter ? `&status=${statusFilter}` : ''}` as any}
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
