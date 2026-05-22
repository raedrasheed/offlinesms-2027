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

const CARD   = 'var(--c-card)';
const BORDER = 'var(--c-border)';

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
    <div className="p-6 space-y-5" style={{ color: 'var(--c-text)' }}>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-[12px] mb-2">
            <Link href={'/admin/points' as any} className="hover:underline" style={{ color: '#5BB6DE' }}>← Points</Link>
            <span style={{ color: 'var(--c-text-4)' }}>/</span>
            <span style={{ color: 'var(--c-text-3)' }}>Transactions</span>
          </div>
          <h1 className="text-[22px] font-extrabold tracking-tight">Transactions</h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>Read-only — no adjustments</p>
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
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--c-error-bg)', border: '1px solid var(--c-error-border)', color: '#EF4444' }}>{fetchError}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl p-12" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <EmptyState title={typeFilter ? 'No transactions match the current filter.' : 'No transactions yet'} />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {['ID', 'User', 'Type', 'Amount', 'Status', 'Created'].map((h, idx) => (
                  <th
                    key={h}
                    className={`px-4 py-3 text-[10px] font-semibold uppercase tracking-wider ${idx === 3 ? 'text-right' : 'text-left'}`}
                    style={{ color: 'var(--c-text-4)' }}
                  >
                    {h}
                  </th>
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
                  <td className="px-4 py-3 font-mono text-[11px]" style={{ color: 'var(--c-text-4)' }}>{t.id.slice(0, 12)}…</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${t.uid}` as any} className="font-mono text-[11px] hover:underline" style={{ color: '#5BB6DE' }}>
                      {t.uid.slice(0, 12)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[11px]" style={{ color: 'var(--c-text-2)' }}>{t.type}</td>
                  <td className="px-4 py-3 text-right font-mono text-[11px] font-bold" style={{ color: t.direction === 'credit' ? '#22C55E' : '#EF4444' }}>
                    {t.direction === 'debit' ? '−' : '+'}{t.amount}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                  <td className="px-4 py-3 text-[11px] whitespace-nowrap" style={{ color: 'var(--c-text-4)' }}>{t.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <div className="px-4 py-3 text-center" style={{ borderTop: `1px solid ${BORDER}` }}>
              <Link
                href={`/admin/points/transactions?cursor=${nextCursor}${typeFilter ? `&type=${typeFilter}` : ''}` as any}
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
