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

const CARD   = 'var(--c-card)';
const BORDER = 'var(--c-border)';

export default async function PackagesPage() {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/points/packages');
  if (!canDo(session.role, 'view:points')) {
    return <div className="p-8"><PermissionState title="Points access required" /></div>;
  }

  const canManage = canDo(session.role, 'manage:packages');

  let rows: Awaited<ReturnType<typeof listPointsPackages>> = [];
  let fetchError: string | null = null;
  try { rows = await listPointsPackages(); }
  catch (e: any) { fetchError = e?.message ?? 'Failed to load packages.'; }

  return (
    <div className="p-6 space-y-5" style={{ color: 'var(--c-text)' }}>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-[12px] mb-2">
            <Link href={'/admin/points' as any} className="hover:underline" style={{ color: '#5BB6DE' }}>← Points</Link>
            <span style={{ color: 'var(--c-text-4)' }}>/</span>
            <span style={{ color: 'var(--c-text-3)' }}>Packages</span>
          </div>
          <h1 className="text-[22px] font-extrabold tracking-tight">Points packages</h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>{rows.length} package{rows.length !== 1 ? 's' : ''}</p>
        </div>
        {canManage && (
          <Link
            href={'/admin/points/packages/new' as any}
            className="px-4 py-2 text-sm font-bold rounded-lg transition hover:brightness-110"
            style={{ background: '#1F7BA8', color: '#fff' }}
          >
            + New package
          </Link>
        )}
      </div>

      {fetchError ? (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--c-error-bg)', border: '1px solid var(--c-error-border)', color: '#EF4444' }}>{fetchError}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl p-12" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <EmptyState title="No packages configured" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {['Name', 'Points', 'Bonus', 'Price', 'Currency', 'Status', 'Order', ...(canManage ? ['Actions'] : [])].map((h, idx) => (
                  <th
                    key={h}
                    className={`px-4 py-3 text-[10px] font-semibold uppercase tracking-wider ${[1,2,3,6].includes(idx) ? 'text-right' : 'text-left'}`}
                    style={{ color: 'var(--c-text-4)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr
                  key={p.id}
                  className="transition hover:bg-white/[0.03]"
                  style={i < rows.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}}
                >
                  <td className="px-4 py-3 font-semibold" style={{ color: 'var(--c-text)' }}>{p.name}</td>
                  <td className="px-4 py-3 text-right font-mono text-[11px] font-bold" style={{ color: '#22C55E' }}>{p.points}</td>
                  <td className="px-4 py-3 text-right font-mono text-[11px]" style={{ color: '#F59E0B' }}>{p.bonusPoints || '—'}</td>
                  <td className="px-4 py-3 text-right font-mono text-[11px]" style={{ color: 'var(--c-text-2)' }}>{p.price}</td>
                  <td className="px-4 py-3 font-mono text-[11px]" style={{ color: 'var(--c-text-2)' }}>{p.currency}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-3 text-right text-[11px]" style={{ color: 'var(--c-text-4)' }}>{p.sortOrder}</td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <Link href={`/admin/points/packages/${p.id}/edit` as any} className="text-[11px] font-semibold hover:underline" style={{ color: '#5BB6DE' }}>
                        Edit →
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
