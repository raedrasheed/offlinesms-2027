// Admin SMS batch list — server component. No SMS/message bodies shown.
// Phase 17: Export CSV button for export:sms roles.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { listSmsBatches } from '@/lib/adminData';
import { PermissionState, EmptyState } from '@/components/state';
import StatusBadge from '@/components/admin/StatusBadge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function SmsAdminPage({
  searchParams,
}: {
  searchParams?: { status?: string; cursor?: string };
}) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/sms');
  if (!canDo(session.role, 'view:sms')) {
    return <div className="p-8"><PermissionState title="SMS access required" /></div>;
  }

  let rows: Awaited<ReturnType<typeof listSmsBatches>> = [];
  let fetchError: string | null = null;
  try {
    rows = await listSmsBatches({ status: searchParams?.status, cursor: searchParams?.cursor });
  } catch (e: any) {
    fetchError = e?.message ?? 'Failed to load SMS batches.';
  }

  const nextCursor   = rows.length === 50 ? rows[rows.length - 1].id : null;
  const statusFilters = ['', 'sending', 'completed', 'failed', 'partial'];
  const canExport    = canDo(session.role, 'export:sms');
  const exportHref   = `/admin/sms/export${searchParams?.status ? `?status=${searchParams.status}` : ''}`;

  return (
    <div className="p-7">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-900">SMS Gateway</h1>
          <p className="text-sm text-ink-500 mt-0.5">Batch history — no message bodies shown</p>
        </div>
        {canExport && (
          <a href={exportHref} className="px-4 py-2 bg-surface3 border border-ink-200 text-ink-700 text-sm font-bold rounded-lg hover:bg-ink-100 transition">
            Export CSV
          </a>
        )}
      </div>

      {/* Status filter */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {statusFilters.map(s => (
          <Link
            key={s}
            href={`/admin/sms${s ? `?status=${s}` : ''}` as any}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
              (searchParams?.status ?? '') === s
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-ink-600 border-ink-200 hover:border-primary'
            }`}
          >
            {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </Link>
        ))}
      </div>

      {fetchError ? (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{fetchError}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-ink-100 bg-white p-12">
          <EmptyState title="No SMS batches" description="Batches will appear here when SMS escalation is used." />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-surface3 text-left text-[10px] font-bold text-ink-500 tracking-wide uppercase">
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Delivered</th>
                <th className="px-4 py-3 text-right">Failed</th>
                <th className="px-4 py-3 text-right">Points</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b, i) => (
                <tr key={b.id} className={`border-t border-ink-100 hover:bg-primary/5 ${i % 2 === 0 ? 'bg-white' : 'bg-surface3/40'}`}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/sms/${b.id}` as any} className="block">
                      <div className="font-mono text-xs text-primary hover:underline">{b.id.slice(0, 14)}…</div>
                      {b.conversationId && (
                        <div className="text-[10px] text-ink-400 mt-0.5">
                          group: {b.conversationId.slice(0, 10)}
                        </div>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                  <td className="px-4 py-3 text-right text-xs font-mono text-ink-700">{b.totalCount}</td>
                  <td className="px-4 py-3 text-right text-xs font-mono text-emerald-700">{b.deliveredCount}</td>
                  <td className="px-4 py-3 text-right text-xs font-mono text-red-700">{b.failedCount}</td>
                  <td className="px-4 py-3 text-right text-xs font-mono text-ink-600">{b.pointsCost}</td>
                  <td className="px-4 py-3 text-xs text-ink-500 whitespace-nowrap">{b.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <div className="px-4 py-3 border-t border-ink-100 text-center">
              <Link href={`/admin/sms?cursor=${nextCursor}${searchParams?.status ? `&status=${searchParams.status}` : ''}` as any}
                className="text-sm text-primary font-semibold hover:underline">
                Load more →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
