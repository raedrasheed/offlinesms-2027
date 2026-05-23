// Admin roles list — server component. Shows users with admin claims/roles.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { listAdminUsers } from '@/lib/adminData';
import { PermissionState, EmptyState } from '@/components/state';
import RoleBadge from '@/components/RoleBadge';
import type { AdminRole } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function RolesAdminPage() {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/roles');
  if (!canDo(session.role, 'view:roles')) {
    return <div className="p-8"><PermissionState title="Roles access required" /></div>;
  }

  let rows: Awaited<ReturnType<typeof listAdminUsers>> = [];
  let fetchError: string | null = null;
  try { rows = await listAdminUsers(); }
  catch (e: any) { fetchError = e?.message ?? 'Failed to load admin users.'; }

  const canManage = canDo(session.role, 'manage:roles');

  return (
    <div className="p-7">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-900">Roles &amp; permissions</h1>
          <p className="text-sm text-ink-500 mt-0.5">{rows.length} admin user{rows.length !== 1 ? 's' : ''}</p>
        </div>
        {!canManage && (
          <div className="text-xs text-ink-400 bg-surface3 border border-ink-100 rounded-lg px-3 py-2">
            Super admin required to assign roles
          </div>
        )}
      </div>

      {fetchError ? (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{fetchError}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-ink-100 bg-white p-12">
          <EmptyState title="No admin users found" description="Grant admin roles via the bootstrap script or setAdminClaim function." />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-surface3 text-left text-[10px] font-bold text-ink-500 tracking-wide uppercase">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Legacy admin</th>
                {canManage && <th className="px-4 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((u, i) => (
                <tr key={u.uid} className={`border-t border-ink-100 hover:bg-primary/5 ${i % 2 === 0 ? 'bg-white' : 'bg-surface3/40'}`}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${u.uid}` as any} className="font-semibold text-ink-900 hover:text-primary block">
                      {u.displayName ?? u.uid.slice(0, 10)}
                    </Link>
                    <div className="text-[10px] font-mono text-ink-400 mt-0.5">{u.uid.slice(0, 14)}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-600 max-w-[180px] truncate">{u.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    {u.role ? <RoleBadge role={u.role as AdminRole} /> : <span className="text-ink-400 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold ${u.isLegacyAdmin ? 'text-amber-600' : 'text-ink-300'}`}>
                      {u.isLegacyAdmin ? 'Yes' : 'No'}
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-4 py-3">
                      {u.uid !== session.user.uid ? (
                        <Link href={`/admin/roles/${u.uid}` as any} className="text-xs text-primary font-semibold hover:underline">
                          Manage →
                        </Link>
                      ) : (
                        <span className="text-xs text-ink-400">You</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
