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

  const CARD = 'var(--c-card)';
  const BORDER = 'var(--c-border)';

  return (
    <div className="p-6 space-y-5" style={{ color: 'var(--c-text)' }}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-[12px] font-medium mb-0.5" style={{ color: 'var(--c-text-3)' }}>Admin / Organizations</p>
          <h1 className="text-[22px] font-extrabold tracking-tight">Organizations</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--c-text-3)' }}>Read-only overview</p>
        </div>
        {canDo(session.role, 'manage:organizations') && (
          <Link href={'/admin/organizations/new' as any}
            className="px-4 py-2 text-sm font-bold rounded-xl transition"
            style={{ background: '#1F7BA8', color: '#fff' }}>
            + New organization
          </Link>
        )}
      </div>

      {fetchError ? (
        <div className="rounded-xl p-4 text-sm" style={{ background: 'var(--c-error-bg)', border: '1px solid var(--c-error-border)', color: '#EF4444' }}>{fetchError}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl p-12" style={{ border: `1px solid ${BORDER}`, background: CARD }}>
          <EmptyState
            title="No organizations yet"
            description="Organizations will appear here when created via the Admin SDK or a future admin action."
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ border: `1px solid ${BORDER}`, background: CARD }}>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-[10px] font-bold tracking-wide uppercase" style={{ borderBottom: `1px solid ${BORDER}`, color: 'var(--c-text-4)' }}>
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
                <tr key={org.id} className="transition hover:bg-white/[0.03]" style={i < rows.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/organizations/${org.id}` as any} className="font-semibold hover:underline" style={{ color: 'var(--c-text)' }}>
                      {org.name}
                    </Link>
                    <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--c-text-4)' }}>{org.id.slice(0, 12)}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--c-text-2)' }}>{org.slug}</td>
                  <td className="px-4 py-3"><StatusBadge status={org.status} /></td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-bold" style={{ color: org.smsEnabled ? '#22C55E' : 'var(--c-text-4)' }}>
                      {org.smsEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-bold" style={{ color: org.pointsEnabled ? '#22C55E' : 'var(--c-text-4)' }}>
                      {org.pointsEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--c-text-3)' }}>{org.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <div className="px-4 py-3 text-center" style={{ borderTop: `1px solid ${BORDER}` }}>
              <Link href={`/admin/organizations?cursor=${nextCursor}` as any} className="text-sm font-semibold hover:underline" style={{ color: '#5BB6DE' }}>
                Load more →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
