import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { listPointsPackages } from '@/lib/adminData';
import { PermissionState, EmptyState } from '@/components/state';
import StatusBadge from '@/components/admin/StatusBadge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function PackagesPage() {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/points/packages');
  if (!canDo(session.role, 'view:points')) {
    return <div className="p-8"><PermissionState title="Points access required" /></div>;
  }

  let rows: Awaited<ReturnType<typeof listPointsPackages>> = [];
  let fetchError: string | null = null;
  try { rows = await listPointsPackages(); }
  catch (e: any) { fetchError = e?.message ?? 'Failed to load packages.'; }

  return (
    <div className="p-7">
      <div className="flex items-center gap-3 mb-6">
        <Link href={'/admin/points' as any} className="text-sm text-ink-500 hover:text-ink-900">← Points</Link>
        <span className="text-ink-300">/</span>
        <span className="text-sm font-semibold text-ink-900">Packages</span>
      </div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-extrabold tracking-tight text-ink-900">Points packages</h1>
        <div className="text-xs text-ink-400 bg-surface3 border border-ink-100 rounded-lg px-3 py-2">
          Package editing deferred to a later phase
        </div>
      </div>
      <p className="text-sm text-ink-500 mb-5">Read-only catalog</p>

      {fetchError ? (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{fetchError}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-ink-100 bg-white p-12"><EmptyState title="No packages configured" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-surface3 text-left text-[10px] font-bold text-ink-500 tracking-wide uppercase">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 text-right">Points</th>
                <th className="px-4 py-3 text-right">Bonus</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Order</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={p.id} className={`border-t border-ink-100 ${i % 2 === 0 ? 'bg-white' : 'bg-surface3/40'}`}>
                  <td className="px-4 py-3 font-semibold text-ink-900">{p.name}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs font-bold text-emerald-700">{p.points}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-amber-700">{p.bonusPoints || '—'}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-ink-700">{p.price}</td>
                  <td className="px-4 py-3 text-xs font-mono text-ink-600">{p.currency}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-3 text-right text-xs text-ink-400">{p.sortOrder}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
