import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { listWallets } from '@/lib/adminData';
import { PermissionState, EmptyState } from '@/components/state';
import StatusBadge from '@/components/admin/StatusBadge';
import WalletFreezeAction from './WalletFreezeAction';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CARD   = '#131B27';
const BORDER = '#1A2437';

export default async function WalletsPage({ searchParams }: { searchParams?: { cursor?: string; status?: string } }) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/points/wallets');
  if (!canDo(session.role, 'view:points')) {
    return <div className="p-8"><PermissionState title="Points access required" /></div>;
  }

  const canFreeze = canDo(session.role, 'manage:wallets');
  const statusFilter = searchParams?.status ?? '';

  let rows: Awaited<ReturnType<typeof listWallets>> = [];
  let fetchError: string | null = null;
  try { rows = await listWallets(searchParams?.cursor, statusFilter || undefined); }
  catch (e: any) { fetchError = e?.message ?? 'Failed to load wallets.'; }

  const nextCursor = rows.length === 50 ? rows[rows.length - 1].uid : null;

  const STATUS_TABS = [
    { label: 'All', value: '' },
    { label: 'Active', value: 'active' },
    { label: 'Frozen', value: 'frozen' },
  ];

  return (
    <div className="p-6 space-y-5" style={{ color: '#E2E8F2' }}>
      <div>
        <div className="flex items-center gap-2 text-[12px] mb-2">
          <Link href={'/admin/points' as any} className="hover:underline" style={{ color: '#5BB6DE' }}>← Points</Link>
          <span style={{ color: '#475569' }}>/</span>
          <span style={{ color: '#64748B' }}>Wallets</span>
        </div>
        <h1 className="text-[22px] font-extrabold tracking-tight">Wallets</h1>
        <p className="text-[13px] mt-0.5" style={{ color: '#64748B' }}>
          {canFreeze ? 'Freeze or unfreeze wallets. Balance is never modified here.' : 'Read-only — no adjustment actions.'}
        </p>
      </div>

      {/* Status tabs */}
      <div className="flex gap-2">
        {STATUS_TABS.map(t => {
          const active = statusFilter === t.value;
          return (
            <a
              key={t.value}
              href={t.value ? `/admin/points/wallets?status=${t.value}` : '/admin/points/wallets'}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition"
              style={active
                ? { background: '#1F7BA8', color: '#fff' }
                : { background: CARD, color: '#94A3B8', border: `1px solid ${BORDER}` }
              }
            >
              {t.label}
            </a>
          );
        })}
      </div>

      {fetchError ? (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: '#2D0D0D', border: '1px solid #3D1515', color: '#EF4444' }}>{fetchError}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl p-12" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <EmptyState title="No wallets yet" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#475569' }}>User</th>
                <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#475569' }}>Balance</th>
                <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#475569' }}>Reserved</th>
                <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#475569' }}>Available</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#475569' }}>Status</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#475569' }}>Updated</th>
                {canFreeze && <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#475569' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((w, i) => (
                <tr
                  key={w.uid}
                  className="transition hover:bg-white/[0.03]"
                  style={i < rows.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}}
                >
                  <td className="px-4 py-3">
                    <Link href={`/admin/points/wallets/${w.uid}` as any} className="font-mono text-[11px] hover:underline" style={{ color: '#5BB6DE' }}>
                      {w.uid.slice(0, 14)}…
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[11px] font-bold" style={{ color: '#E2E8F2' }}>{w.balance}</td>
                  <td className="px-4 py-3 text-right font-mono text-[11px]" style={{ color: '#F59E0B' }}>{w.reserved}</td>
                  <td className="px-4 py-3 text-right font-mono text-[11px]" style={{ color: '#22C55E' }}>{w.available}</td>
                  <td className="px-4 py-3"><StatusBadge status={w.status} /></td>
                  <td className="px-4 py-3 text-[11px] whitespace-nowrap" style={{ color: '#475569' }}>{w.updatedAt}</td>
                  {canFreeze && (
                    <td className="px-4 py-3">
                      <WalletFreezeAction uid={w.uid} currentStatus={w.status} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <div className="px-4 py-3 text-center" style={{ borderTop: `1px solid ${BORDER}` }}>
              <Link
                href={`/admin/points/wallets?cursor=${nextCursor}${statusFilter ? `&status=${statusFilter}` : ''}` as any}
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
