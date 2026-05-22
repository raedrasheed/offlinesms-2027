// Admin transactions — server component.
// Phase 17: adds type filter via FilterBar and Export CSV button.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { listTransactions } from '@/lib/adminData';
import { PermissionState, EmptyState } from '@/components/state';
import StatusBadge from '@/components/admin/StatusBadge';
import FilterBar from '@/components/admin/FilterBar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams?: { cursor?: string; type?: string };
}) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/points/transactions');
  if (!canDo(session.role, 'view:points')) {
    return <div className="p-8"><PermissionState title="Points access required" /></div>;
  }

  const typeFilter = searchParams?.type ?? '';
  const canExport  = canDo(session.role, 'export:points');

  let rows: Awaited<ReturnType<typeof listTransactions>> = [];
  let fetchError: string | null = null;
  try { rows = await listTransactions(searchParams?.cursor, undefined, typeFilter || undefined); }
  catch (e: any) { fetchError = e?.message ?? 'Failed to load transactions.'; }

  const nextCursor = rows.length === 50 ? rows[rows.length - 1].id : null;

  function buildExportHref() {
    const p = new URLSearchParams();
    if (typeFilter) p.set('type', typeFilter);
    const qs = p.toString();
    return `/admin/points/transactions/export${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="p-7">
      <div className="flex items-center gap-3 mb-6">
        <Link href={'/admin/points' as any} className="text-sm text-ink-500 hover:text-ink-900">← Points</Link>
        <span className="text-ink-300">/</span>
        <span className="text-sm font-semibold text-ink-900">Transactions</span>
        {canExport && (
          <a href={buildExportHref()} className="ml-auto px-4 py-2 bg-surface3 border border-ink-200 text-ink-700 text-sm font-bold rounded-lg hover:bg-ink-100 transition">
            Export CSV
          </a>
        )}
      </div>
      <h1 className="text-xl font-extrabold tracking-tight text-ink-900 mb-1">Transactions</h1>
      <p className="text-sm text-ink-500 mb-5">Read-only — no adjustments</p>

      <Suspense>
        <FilterBar
          searchPlaceholder="Filter by user UID in global search (⌘K)"
          filters={[
            { key: 'type', label: 'All types', options: [
              { value: 'purchase',  label: 'Purchase' },
              { value: 'spend',     label: 'Spend' },
              { value: 'transfer',  label: 'Transfer' },
              { value: 'refund',    label: 'Refund' },
              { value: 'bonus',     label: 'Bonus' },
            ]},
          ]}
        />
      </Suspense>

      {fetchError ? (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{fetchError}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-ink-100 bg-white p-12"><EmptyState title={typeFilter ? 'No transactions match the current filter.' : 'No transactions yet'} /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-surface3 text-left text-[10px] font-bold text-ink-500 tracking-wide uppercase">
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => (
                <tr key={t.id} className={`border-t border-ink-100 ${i % 2 === 0 ? 'bg-white' : 'bg-surface3/40'}`}>
                  <td className="px-4 py-3 font-mono text-[11px] text-ink-400">{t.id.slice(0, 12)}…</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${t.uid}` as any} className="font-mono text-xs text-primary hover:underline">
                      {t.uid.slice(0, 12)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-700">{t.type}</td>
                  <td className={`px-4 py-3 text-right font-mono text-xs font-bold ${t.direction === 'credit' ? 'text-emerald-700' : 'text-red-700'}`}>
                    {t.direction === 'debit' ? '−' : '+'}{t.amount}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                  <td className="px-4 py-3 text-xs text-ink-500 whitespace-nowrap">{t.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <div className="px-4 py-3 border-t border-ink-100 text-center">
              <Link href={`/admin/points/transactions?cursor=${nextCursor}${typeFilter ? `&type=${typeFilter}` : ''}` as any} className="text-sm text-primary font-semibold hover:underline">Load more →</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
