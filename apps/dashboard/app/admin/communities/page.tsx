// Admin communities foundation — server component.
// If communities collection is empty or absent, shows a scaffold empty state.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { listCommunities } from '@/lib/adminData';
import { PermissionState, EmptyState } from '@/components/state';
import StatusBadge from '@/components/admin/StatusBadge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function CommunitiesAdminPage() {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/communities');
  if (!canDo(session.role, 'view:communities')) {
    return <div className="p-8"><PermissionState title="Communities access required" /></div>;
  }

  let rows: Awaited<ReturnType<typeof listCommunities>> = [];
  let fetchError: string | null = null;
  try {
    rows = await listCommunities();
  } catch (e: any) {
    // Collection may not exist — treat as empty.
    fetchError = null;
    rows = [];
  }

  return (
    <div className="p-7">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-900">Communities</h1>
          <p className="text-sm text-ink-500 mt-0.5">Foundation scaffold — full feature in a later phase</p>
        </div>
        <div className="text-xs text-ink-400 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2 font-semibold">
          Read-only preview
        </div>
      </div>

      {fetchError ? (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{fetchError}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-ink-100 bg-white p-12">
          <EmptyState
            title="Communities are not enabled yet"
            description="The communities feature will be built in a future phase. This page and navigation are scaffolded and ready."
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-surface3 text-left text-[10px] font-bold text-ink-500 tracking-wide uppercase">
                <th className="px-4 py-3">Community</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Groups</th>
                <th className="px-4 py-3">Members</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={c.id} className={`border-t border-ink-100 hover:bg-primary/5 ${i % 2 === 0 ? 'bg-white' : 'bg-surface3/40'}`}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/communities/${c.id}` as any} className="font-semibold text-ink-900 hover:text-primary">
                      {c.name ?? '—'}
                    </Link>
                    <div className="text-[10px] text-ink-400 font-mono mt-0.5">{c.id.slice(0, 12)}</div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-xs text-ink-600">{c.groupCount}</td>
                  <td className="px-4 py-3 text-xs text-ink-600">{c.memberCount}</td>
                  <td className="px-4 py-3 text-xs text-ink-500 whitespace-nowrap">{c.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
