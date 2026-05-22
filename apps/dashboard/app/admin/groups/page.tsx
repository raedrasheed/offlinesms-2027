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
    <div className="p-7">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-900">Groups</h1>
          <p className="text-sm text-ink-500 mt-0.5">
            {rows.length === 50 ? '50+ groups' : `${rows.length} group${rows.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        {canExport && (
          <a href={buildExportHref()} className="px-4 py-2 bg-surface3 border border-ink-200 text-ink-700 text-sm font-bold rounded-lg hover:bg-ink-100 transition">
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
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{fetchError}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-ink-100 bg-white p-12">
          <EmptyState title="No groups found" description={statusFilter ? 'No groups match the current filter.' : 'Group conversations will appear here.'} />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-surface3 text-left text-[10px] font-bold text-ink-500 tracking-wide uppercase">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Members</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Org</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g, i) => (
                <tr key={g.id} className={`border-t border-ink-100 hover:bg-primary/5 ${i % 2 === 0 ? 'bg-white' : 'bg-surface3/40'}`}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/groups/${g.id}` as any} className="font-semibold text-ink-900 hover:text-primary">
                      {g.name ?? '—'}
                    </Link>
                    <div className="text-[10px] text-ink-400 font-mono mt-0.5">{g.id.slice(0, 12)}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-600">{g.memberCount}</td>
                  <td className="px-4 py-3"><StatusBadge status={g.status} /></td>
                  <td className="px-4 py-3 text-xs text-ink-400 font-mono">
                    {g.organizationId ? g.organizationId.slice(0, 10) : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-500 whitespace-nowrap">{g.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <div className="px-4 py-3 border-t border-ink-100 text-center">
              <Link href={`/admin/groups?cursor=${nextCursor}${statusFilter ? `&status=${statusFilter}` : ''}` as any} className="text-sm text-primary font-semibold hover:underline">
                Load more →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
