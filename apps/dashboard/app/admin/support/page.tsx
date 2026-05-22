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
  searchParams?: { status?: string; category?: string; cursor?: string };
}) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/support');
  if (!canDo(session.role, 'view:support')) {
    return <div className="p-8"><PermissionState title="Support access required" /></div>;
  }

  const statusFilter   = searchParams?.status   ?? '';
  const categoryFilter = searchParams?.category ?? '';

  let rows: Awaited<ReturnType<typeof listSupportTickets>> = [];
  let fetchError: string | null = null;
  try {
    rows = await listSupportTickets({
      status:   statusFilter   || undefined,
      category: categoryFilter || undefined,
      cursor:   searchParams?.cursor,
    });
  } catch (e: any) {
    fetchError = e?.message ?? 'Failed to load support tickets.';
  }

  const nextCursor = rows.length === 50 ? rows[rows.length - 1].id : null;
  const canExport  = canDo(session.role, 'export:support');
  const exportHref = `/admin/support/export${statusFilter ? `?status=${statusFilter}` : ''}${categoryFilter ? `${statusFilter ? '&' : '?'}category=${categoryFilter}` : ''}`;

  return (
    <div className="p-7">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-900">Support queue</h1>
          <p className="text-sm text-ink-500 mt-0.5">{rows.length}{nextCursor ? '+' : ''} ticket{rows.length !== 1 ? 's' : ''}</p>
        </div>
        {canExport && (
          <a href={exportHref} className="px-4 py-2 bg-surface3 border border-ink-200 text-ink-700 text-sm font-bold rounded-lg hover:bg-ink-100 transition">
            Export CSV
          </a>
        )}
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {STATUS_TABS.map(t => {
          const href = t.value
            ? `/admin/support?status=${t.value}${categoryFilter ? `&category=${categoryFilter}` : ''}`
            : `/admin/support${categoryFilter ? `?category=${categoryFilter}` : ''}`;
          return (
            <a
              key={t.value}
              href={href}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                statusFilter === t.value
                  ? 'bg-primary text-white'
                  : 'bg-surface3 text-ink-600 hover:bg-ink-100'
              }`}
            >
              {t.label}
            </a>
          );
        })}
        {/* Category filter */}
        <div className="ml-auto">
          <select
            defaultValue={categoryFilter}
            onChange={e => {
              const url = new URL(window.location.href);
              if (e.target.value) url.searchParams.set('category', e.target.value);
              else url.searchParams.delete('category');
              url.searchParams.delete('cursor');
              window.location.href = url.toString();
            }}
            className="bg-white border border-ink-200 rounded-lg px-3 py-1.5 text-xs text-ink-700 outline-none"
          >
            <option value="">All categories</option>
            <option value="billing">Billing</option>
            <option value="technical">Technical</option>
            <option value="account">Account</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {fetchError ? (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{fetchError}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-ink-100 bg-white p-12">
          <EmptyState title="No tickets found" description="No support tickets match the current filters." />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-surface3 text-left text-[10px] font-bold text-ink-500 tracking-wide uppercase">
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Assigned</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => (
                <tr key={t.id} className={`border-t border-ink-100 hover:bg-primary/5 ${i % 2 === 0 ? 'bg-white' : 'bg-surface3/40'}`}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/support/${t.id}` as any} className="font-semibold text-ink-900 hover:text-primary block truncate max-w-[200px]">
                      {t.subject}
                    </Link>
                    <div className="text-[10px] font-mono text-ink-400 mt-0.5">{t.id.slice(0, 12)}…</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-600 capitalize">{t.category}</td>
                  <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${t.createdBy}` as any} className="font-mono text-[11px] text-primary hover:underline">
                      {t.createdBy.slice(0, 10)}…
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-500">
                    {t.assignedTo ? <span className="font-mono text-[11px]">{t.assignedTo.slice(0, 10)}…</span> : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-500 whitespace-nowrap">{t.createdAt}</td>
                  <td className="px-4 py-3 text-xs text-ink-500 whitespace-nowrap">{t.updatedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <div className="px-4 py-3 border-t border-ink-100 text-center">
              <Link
                href={`/admin/support?cursor=${nextCursor}${statusFilter ? `&status=${statusFilter}` : ''}${categoryFilter ? `&category=${categoryFilter}` : ''}` as any}
                className="text-sm text-primary font-semibold hover:underline"
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
