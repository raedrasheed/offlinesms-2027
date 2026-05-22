// Admin users list — server component.
// Reads users via Admin SDK. Phones masked. Email shown to super/support roles.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { listUsers } from '@/lib/adminData';
import { maskPhone, maskEmail } from '@/lib/redaction';
import { PermissionState } from '@/components/state';
import StatusBadge from '@/components/admin/StatusBadge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function UsersAdminPage({
  searchParams,
}: {
  searchParams?: { cursor?: string };
}) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/users');
  if (!canDo(session.role, 'view:users')) {
    return <div className="p-8"><PermissionState title="Users access required" /></div>;
  }

  let rows: Awaited<ReturnType<typeof listUsers>> = [];
  let fetchError: string | null = null;
  try {
    rows = await listUsers(searchParams?.cursor);
  } catch (e: any) {
    fetchError = e?.message ?? 'Failed to load users.';
  }

  const nextCursor = rows.length === 50 ? rows[rows.length - 1].uid : null;

  return (
    <div className="p-7">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-900">Users</h1>
          <p className="text-sm text-ink-500 mt-0.5">{rows.length === 50 ? '50+ users' : `${rows.length} users`}</p>
        </div>
      </div>

      {fetchError ? (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{fetchError}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-surface3 text-left text-[10px] font-bold text-ink-500 tracking-wide uppercase">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Profile</th>
                <th className="px-4 py-3">Joined</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-ink-500">
                    No users yet.
                  </td>
                </tr>
              ) : rows.map((u, i) => (
                <tr key={u.uid} className={`border-t border-ink-100 hover:bg-primary/5 ${i % 2 === 0 ? 'bg-white' : 'bg-surface3/40'}`}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${u.uid}` as any} className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-primary/20 text-primary font-bold text-xs grid place-items-center shrink-0">
                        {(u.displayName ?? u.uid).slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-ink-900 truncate">{u.displayName ?? '—'}</div>
                        <div className="text-[10px] text-ink-400 font-mono truncate">
                          {u.username ? `@${u.username}` : u.uid.slice(0, 10)}
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-600">{maskPhone(u.phoneNumber)}</td>
                  <td className="px-4 py-3 text-xs text-ink-600 max-w-[160px] truncate">{maskEmail(u.email, session.role)}</td>
                  <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold ${u.profileCompleted ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {u.profileCompleted ? 'Complete' : 'Pending'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-500 whitespace-nowrap">{u.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <div className="px-4 py-3 border-t border-ink-100 text-center">
              <Link href={`/admin/users?cursor=${nextCursor}` as any} className="text-sm text-primary font-semibold hover:underline">
                Load more →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
