import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { listWallets } from '@/lib/adminData';
import { PermissionState, EmptyState } from '@/components/state';
import StatusBadge from '@/components/admin/StatusBadge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function WalletsPage({ searchParams }: { searchParams?: { cursor?: string } }) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/points/wallets');
  if (!canDo(session.role, 'view:points')) {
    return <div className="p-8"><PermissionState title="Points access required" /></div>;
  }

  let rows: Awaited<ReturnType<typeof listWallets>> = [];
  let fetchError: string | null = null;
  try { rows = await listWallets(searchParams?.cursor); }
  catch (e: any) { fetchError = e?.message ?? 'Failed to load wallets.'; }

  const nextCursor = rows.length === 50 ? rows[rows.length - 1].uid : null;

  return (
    <div className="p-7">
      <div className="flex items-center gap-3 mb-6">
        <Link href={'/admin/points' as any} className="text-sm text-ink-500 hover:text-ink-900">← Points</Link>
        <span className="text-ink-300">/</span>
        <span className="text-sm font-semibold text-ink-900">Wallets</span>
      </div>
      <h1 className="text-xl font-extrabold tracking-tight text-ink-900 mb-1">Wallets</h1>
      <p className="text-sm text-ink-500 mb-5">Read-only — no adjustment actions</p>

      {fetchError ? (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{fetchError}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-ink-100 bg-white p-12">
          <EmptyState title="No wallets yet" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-surface3 text-left text-[10px] font-bold text-ink-500 tracking-wide uppercase">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3 text-right">Reserved</th>
                <th className="px-4 py-3 text-right">Available</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w, i) => (
                <tr key={w.uid} className={`border-t border-ink-100 hover:bg-primary/5 ${i % 2 === 0 ? 'bg-white' : 'bg-surface3/40'}`}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${w.uid}` as any} className="font-mono text-xs text-primary hover:underline">
                      {w.uid.slice(0, 14)}…
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs font-bold text-ink-900">{w.balance}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-amber-700">{w.reserved}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-emerald-700">{w.available}</td>
                  <td className="px-4 py-3"><StatusBadge status={w.status} /></td>
                  <td className="px-4 py-3 text-xs text-ink-500 whitespace-nowrap">{w.updatedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <div className="px-4 py-3 border-t border-ink-100 text-center">
              <Link href={`/admin/points/wallets?cursor=${nextCursor}` as any} className="text-sm text-primary font-semibold hover:underline">
                Load more →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
