// Admin groups list — server component.
// Phase 17: adds status filter via FilterBar and Export CSV button.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { listGroups } from '@/lib/adminData';
import { PermissionState, EmptyState } from '@/components/state';
import StatusBadge from '@/components/admin/StatusBadge';
import FilterBar from '@/components/admin/FilterBar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CARD   = '#131B27';
const BORDER = '#1A2437';

export default async function GroupsAdminPage({
  searchParams,
}: {
  searchParams?: { cursor?: string; status?: string };
}) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/groups');
  if (!canDo(session.role, 'view:groups')) {
    return <div className="p-8"><PermissionState title="Groups access required" /></div>;
  }

  const statusFilter = searchParams?.status ?? '';
  const canExport    = canDo(session.role, 'export:groups');

  let rows: Awaited<ReturnType<typeof listGroups>> = [];
  let fetchError: string | null = null;
  try {
    rows = await listGroups(searchParams?.cursor, statusFilter || undefined);
  } catch (e: any) {
    fetchError = e?.message ?? 'Failed to load groups.';
  }

  const nextCursor = rows.length === 50 ? rows[rows.length - 1].id : null;

  function buildExportHref() {
    const p = new URLSearchParams();
    if (statusFilter) p.set('status', statusFilter);
    const qs = p.toString();
    return `/admin/groups/export${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="p-6 space-y-5" style={{ color: '#E2E8F2' }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-medium mb-0.5" style={{ color: '#64748B' }}>Admin / Groups</p>
          <h1 className="text-[22px] font-extrabold tracking-tight">Groups</h1>
          <p className="text-[13px] mt-0.5" style={{ color: '#64748B' }}>
            {rows.length === 50 ? '50+ groups' : `${rows.length} group${rows.length !== 1 ? 's' : ''}`}
          </p>
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
          searchPlaceholder="Search by group name in global search (⌘K)"
          filters={[
            { key: 'status', label: 'All statuses', options: [
              { value: 'active',   label: 'Active' },
              { value: 'locked',   label: 'Locked' },
              { value: 'archived', label: 'Archived' },
            ]},
          ]}
        />
      </Suspense>

      {fetchError ? (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: '#2D0D0D', border: '1px solid #3D1515', color: '#EF4444' }}>
          {fetchError}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl p-12" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <EmptyState title="No groups found" description={statusFilter ? 'No groups match the current filter.' : 'Group conversations will appear here.'} />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {['Name', 'Members', 'Status', 'Org', 'Created'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-[10px]" style={{ color: '#475569' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((g, i) => (
                <tr
                  key={g.id}
                  className="transition hover:bg-white/[0.03]"
                  style={i < rows.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}}
                >
                  <td className="px-4 py-3">
                    <Link href={`/admin/groups/${g.id}` as any} className="font-semibold hover:underline" style={{ color: '#E2E8F2' }}>
                      {g.name ?? '—'}
                    </Link>
                    <div className="text-[10px] font-mono mt-0.5" style={{ color: '#475569' }}>{g.id.slice(0, 12)}</div>
                  </td>
                  <td className="px-4 py-3" style={{ color: '#94A3B8' }}>{g.memberCount}</td>
                  <td className="px-4 py-3"><StatusBadge status={g.status} /></td>
                  <td className="px-4 py-3 font-mono text-[11px]" style={{ color: '#475569' }}>
                    {g.organizationId ? g.organizationId.slice(0, 10) : '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap" style={{ color: '#475569' }}>{g.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <div className="px-4 py-3 text-center" style={{ borderTop: `1px solid ${BORDER}` }}>
              <Link
                href={`/admin/groups?cursor=${nextCursor}${statusFilter ? `&status=${statusFilter}` : ''}` as any}
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
