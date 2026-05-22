// Admin users list — server component.
// Reads users via Admin SDK. Phones masked. Email shown to super/support roles.
// Phase 17: adds status filter via FilterBar and Export CSV button.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { listUsers } from '@/lib/adminData';
import { maskPhone, maskEmail } from '@/lib/redaction';
import { PermissionState } from '@/components/state';
import StatusBadge from '@/components/admin/StatusBadge';
import FilterBar from '@/components/admin/FilterBar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CARD   = 'var(--c-card)';
const BORDER = 'var(--c-border)';

export default async function UsersAdminPage({
  searchParams,
}: {
  searchParams?: { cursor?: string; status?: string };
}) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/users');
  if (!canDo(session.role, 'view:users')) {
    return <div className="p-8"><PermissionState title="Users access required" /></div>;
  }

  const statusFilter = searchParams?.status ?? '';
  const canExport    = canDo(session.role, 'export:users');

  let rows: Awaited<ReturnType<typeof listUsers>> = [];
  let fetchError: string | null = null;
  try {
    rows = await listUsers(searchParams?.cursor, statusFilter || undefined);
  } catch (e: any) {
    fetchError = e?.message ?? 'Failed to load users.';
  }

  const nextCursor = rows.length === 50 ? rows[rows.length - 1].uid : null;

  function buildExportHref() {
    const p = new URLSearchParams();
    if (statusFilter) p.set('status', statusFilter);
    const qs = p.toString();
    return `/admin/users/export${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="p-6 space-y-5" style={{ color: 'var(--c-text)' }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-medium mb-0.5" style={{ color: 'var(--c-text-3)' }}>Admin / Users</p>
          <h1 className="text-[22px] font-extrabold tracking-tight">Users</h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>
            {rows.length === 50 ? '50+ users' : `${rows.length} user${rows.length !== 1 ? 's' : ''}`}
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
          searchPlaceholder="Search by username or UID in global search (⌘K)"
          filters={[
            { key: 'status', label: 'All statuses', options: [
              { value: 'active',    label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
              { value: 'suspended', label: 'Suspended' },
            ]},
          ]}
        />
      </Suspense>

      {fetchError ? (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--c-error-bg)', border: '1px solid var(--c-error-border)', color: '#EF4444' }}>
          {fetchError}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {['User', 'Phone', 'Email', 'Status', 'Profile', 'Joined'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-[10px]" style={{ color: 'var(--c-text-4)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--c-text-3)' }}>
                    {statusFilter ? 'No users match the current filter.' : 'No users yet.'}
                  </td>
                </tr>
              ) : rows.map((u, i) => (
                <tr
                  key={u.uid}
                  className="transition hover:bg-white/[0.03]"
                  style={i < rows.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}}
                >
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${u.uid}` as any} className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-8 h-8 rounded-full font-bold text-xs grid place-items-center shrink-0"
                        style={{ background: '#1F7BA822', color: '#5BB6DE' }}
                      >
                        {(u.displayName ?? u.uid).slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold truncate" style={{ color: 'var(--c-text)' }}>{u.displayName ?? '—'}</div>
                        <div className="text-[10px] font-mono truncate" style={{ color: 'var(--c-text-4)' }}>
                          {u.username ? `@${u.username}` : u.uid.slice(0, 10)}
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px]" style={{ color: 'var(--c-text-2)' }}>{maskPhone(u.phoneNumber)}</td>
                  <td className="px-4 py-3 text-[11px] max-w-[160px] truncate" style={{ color: 'var(--c-text-2)' }}>{maskEmail(u.email, session.role)}</td>
                  <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-bold" style={{ color: u.profileCompleted ? '#22C55E' : '#F59E0B' }}>
                      {u.profileCompleted ? 'Complete' : 'Pending'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[11px] whitespace-nowrap" style={{ color: 'var(--c-text-4)' }}>{u.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <div className="px-4 py-3 text-center" style={{ borderTop: `1px solid ${BORDER}` }}>
              <Link
                href={`/admin/users?cursor=${nextCursor}${statusFilter ? `&status=${statusFilter}` : ''}` as any}
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
