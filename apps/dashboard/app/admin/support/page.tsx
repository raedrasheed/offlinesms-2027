// Admin support queue — server component.
// Lists support tickets. Status and category filters via query params.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { listSupportTickets } from '@/lib/adminData';
import { PermissionState, EmptyState } from '@/components/state';
import StatusBadge from '@/components/admin/StatusBadge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CARD   = '#131B27';
const BORDER = '#1A2437';

const STATUS_TABS = [
  { label: 'All',      value: '' },
  { label: 'Open',     value: 'open' },
  { label: 'Pending',  value: 'pending' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'Closed',   value: 'closed' },
];

export default async function SupportPage({
  searchParams,
}: {
  searchParams?: { status?: string; category?: string; assignedTo?: string; cursor?: string };
}) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/support');
  if (!canDo(session.role, 'view:support')) {
    return <div className="p-8"><PermissionState title="Support access required" /></div>;
  }

  const statusFilter     = searchParams?.status     ?? '';
  const categoryFilter   = searchParams?.category   ?? '';
  const assignedToFilter = searchParams?.assignedTo ?? '';

  let rows: Awaited<ReturnType<typeof listSupportTickets>> = [];
  let fetchError: string | null = null;
  try {
    rows = await listSupportTickets({
      status:     statusFilter     || undefined,
      category:   categoryFilter   || undefined,
      assignedTo: assignedToFilter || undefined,
      cursor:     searchParams?.cursor,
    });
  } catch (e: any) {
    fetchError = e?.message ?? 'Failed to load support tickets.';
  }

  const nextCursor = rows.length === 50 ? rows[rows.length - 1].id : null;
  const canExport  = canDo(session.role, 'export:support');
  const exportHref = `/admin/support/export${statusFilter ? `?status=${statusFilter}` : ''}${categoryFilter ? `${statusFilter ? '&' : '?'}category=${categoryFilter}` : ''}`;

  const selectStyle = {
    background: '#131B27',
    border: '1px solid #1A2437',
    color: '#E2E8F2',
  };

  return (
    <div className="p-6 space-y-5" style={{ color: '#E2E8F2' }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-medium mb-0.5" style={{ color: '#64748B' }}>Admin / Support</p>
          <h1 className="text-[22px] font-extrabold tracking-tight">Support queue</h1>
          <p className="text-[13px] mt-0.5" style={{ color: '#64748B' }}>
            {rows.length}{nextCursor ? '+' : ''} ticket{rows.length !== 1 ? 's' : ''}
          </p>
        </div>
        {canExport && (
          <a
            href={exportHref}
            className="px-4 py-2 text-sm font-bold rounded-lg transition hover:brightness-110"
            style={{ background: '#0A1828', color: '#5BB6DE', border: '1px solid #0E3A5A' }}
          >
            Export CSV
          </a>
        )}
      </div>

      {/* Status tabs + filters */}
      <div className="flex gap-2 flex-wrap items-center">
        {STATUS_TABS.map(t => {
          const href = t.value
            ? `/admin/support?status=${t.value}${categoryFilter ? `&category=${categoryFilter}` : ''}`
            : `/admin/support${categoryFilter ? `?category=${categoryFilter}` : ''}`;
          const active = statusFilter === t.value;
          return (
            <a
              key={t.value}
              href={href}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition"
              style={active
                ? { background: '#1F7BA8', color: '#fff' }
                : { background: '#131B27', color: '#94A3B8', border: '1px solid #1A2437' }
              }
            >
              {t.label}
            </a>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <select
            defaultValue={categoryFilter}
            onChange={e => {
              const url = new URL(window.location.href);
              if (e.target.value) url.searchParams.set('category', e.target.value);
              else url.searchParams.delete('category');
              url.searchParams.delete('cursor');
              window.location.href = url.toString();
            }}
            className="rounded-lg px-3 py-1.5 text-[11px] outline-none"
            style={selectStyle}
          >
            <option value="">All categories</option>
            <option value="billing">Billing</option>
            <option value="technical">Technical</option>
            <option value="account">Account</option>
            <option value="other">Other</option>
          </select>
          <input
            type="text"
            placeholder="Assigned to (UID)"
            defaultValue={assignedToFilter}
            onBlur={e => {
              const url = new URL(window.location.href);
              const v = e.target.value.trim();
              if (v) url.searchParams.set('assignedTo', v);
              else url.searchParams.delete('assignedTo');
              url.searchParams.delete('cursor');
              window.location.href = url.toString();
            }}
            className="rounded-lg px-3 py-1.5 text-[11px] outline-none font-mono w-36"
            style={selectStyle}
          />
        </div>
      </div>

      {fetchError ? (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: '#2D0D0D', border: '1px solid #3D1515', color: '#EF4444' }}>
          {fetchError}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl p-12" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <EmptyState title="No tickets found" description="No support tickets match the current filters." />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {['Subject', 'Category', 'Status', 'User', 'Assigned', 'Created', 'Updated'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#475569' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => (
                <tr
                  key={t.id}
                  className="transition hover:bg-white/[0.03]"
                  style={i < rows.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}}
                >
                  <td className="px-4 py-3">
                    <Link href={`/admin/support/${t.id}` as any} className="font-semibold hover:underline block truncate max-w-[200px]" style={{ color: '#E2E8F2' }}>
                      {t.subject}
                    </Link>
                    <div className="text-[10px] font-mono mt-0.5" style={{ color: '#475569' }}>{t.id.slice(0, 12)}…</div>
                  </td>
                  <td className="px-4 py-3 capitalize" style={{ color: '#94A3B8' }}>{t.category}</td>
                  <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${t.createdBy}` as any} className="font-mono text-[11px] hover:underline" style={{ color: '#5BB6DE' }}>
                      {t.createdBy.slice(0, 10)}…
                    </Link>
                  </td>
                  <td className="px-4 py-3" style={{ color: '#475569' }}>
                    {t.assignedTo ? <span className="font-mono text-[11px]">{t.assignedTo.slice(0, 10)}…</span> : '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-[11px]" style={{ color: '#475569' }}>{t.createdAt}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-[11px]" style={{ color: '#475569' }}>{t.updatedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <div className="px-4 py-3 text-center" style={{ borderTop: `1px solid ${BORDER}` }}>
              <Link
                href={`/admin/support?cursor=${nextCursor}${statusFilter ? `&status=${statusFilter}` : ''}${categoryFilter ? `&category=${categoryFilter}` : ''}` as any}
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
