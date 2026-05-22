// Admin organizations list — server component, read-only.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { listOrganizations } from '@/lib/adminData';
import { PermissionState, EmptyState } from '@/components/state';
import StatusBadge from '@/components/admin/StatusBadge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function OrgsAdminPage({
  searchParams,
}: {
  searchParams?: { cursor?: string };
}) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/organizations');
  if (!canDo(session.role, 'view:organizations')) {
    return <div className="p-8"><PermissionState title="Organizations access required" /></div>;
  }

  let rows: Awaited<ReturnType<typeof listOrganizations>> = [];
  let fetchError: string | null = null;
  try {
    rows = await listOrganizations(searchParams?.cursor);
  } catch (e: any) {
    fetchError = e?.message ?? 'Failed to load organizations.';
  }

  const nextCursor = rows.length === 50 ? rows[rows.length - 1].id : null;

  return (
    <div className="p-7">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-900">Organizations</h1>
          <p className="text-sm text-ink-500 mt-0.5">Read-only overview</p>
        </div>
        <div className="text-xs text-ink-400 bg-surface3 border border-ink-100 rounded-lg px-3 py-2">
          Write actions available in a later phase
        </div>
      </div>

      {fetchError ? (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{fetchError}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-ink-100 bg-white p-12">
          <EmptyState
            title="No organizations yet"
            description="Organizations will appear here when created via the Admin SDK or a future admin action."
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-surface3 text-left text-[10px] font-bold text-ink-500 tracking-wide uppercase">
                <th className="px-4 py-3">Organization</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">SMS</th>
                <th className="px-4 py-3">Points</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((org, i) => (
                <tr key={org.id} className={`border-t border-ink-100 hover:bg-primary/5 ${i % 2 === 0 ? 'bg-white' : 'bg-surface3/40'}`}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/organizations/${org.id}` as any} className="font-semibold text-ink-900 hover:text-primary">
                      {org.name}
                    </Link>
                    <div className="text-[10px] text-ink-400 font-mono mt-0.5">{org.id.slice(0, 12)}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-600">{org.slug}</td>
                  <td className="px-4 py-3"><StatusBadge status={org.status} /></td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold ${org.smsEnabled ? 'text-emerald-600' : 'text-ink-400'}`}>
                      {org.smsEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold ${org.pointsEnabled ? 'text-emerald-600' : 'text-ink-400'}`}>
                      {org.pointsEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-500 whitespace-nowrap">{org.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <div className="px-4 py-3 border-t border-ink-100 text-center">
              <Link href={`/admin/organizations?cursor=${nextCursor}` as any} className="text-sm text-primary font-semibold hover:underline">
                Load more →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
