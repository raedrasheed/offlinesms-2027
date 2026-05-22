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

  const CARD = '#131B27';
  const BORDER = '#1A2437';

  return (
    <div className="p-6 space-y-5" style={{ color: '#E2E8F2' }}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-[12px] font-medium mb-0.5" style={{ color: '#64748B' }}>Admin / Communities</p>
          <h1 className="text-[22px] font-extrabold tracking-tight">Communities</h1>
          <p className="text-sm mt-0.5" style={{ color: '#64748B' }}>Foundation scaffold — full feature in a later phase</p>
        </div>
        <div className="text-xs rounded-lg px-3 py-2 font-semibold" style={{ background: '#1C1405', color: '#F59E0B', border: `1px solid #3D2E0A` }}>
          Read-only preview
        </div>
      </div>

      {fetchError ? (
        <div className="rounded-xl p-4 text-sm" style={{ background: '#2D0D0D', border: '1px solid #3D1515', color: '#EF4444' }}>{fetchError}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl p-12" style={{ border: `1px solid ${BORDER}`, background: CARD }}>
          <EmptyState
            title="Communities are not enabled yet"
            description="The communities feature will be built in a future phase. This page and navigation are scaffolded and ready."
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ border: `1px solid ${BORDER}`, background: CARD }}>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-[10px] font-bold tracking-wide uppercase" style={{ borderBottom: `1px solid ${BORDER}`, color: '#475569' }}>
                <th className="px-4 py-3">Community</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Groups</th>
                <th className="px-4 py-3">Members</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={c.id} className="transition hover:bg-white/[0.03]" style={i < rows.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/communities/${c.id}` as any} className="font-semibold hover:underline" style={{ color: '#E2E8F2' }}>
                      {c.name ?? '—'}
                    </Link>
                    <div className="text-[10px] font-mono mt-0.5" style={{ color: '#475569' }}>{c.id.slice(0, 12)}</div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#94A3B8' }}>{c.groupCount}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#94A3B8' }}>{c.memberCount}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: '#64748B' }}>{c.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
