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

const CARD   = '#131B27';
const BORDER = '#1A2437';

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
    <div className="p-6 space-y-5" style={{ color: '#E2E8F2' }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-medium mb-0.5" style={{ color: '#64748B' }}>Admin / SMS</p>
          <h1 className="text-[22px] font-extrabold tracking-tight">SMS Gateway</h1>
          <p className="text-[13px] mt-0.5" style={{ color: '#64748B' }}>Batch history — no message bodies shown</p>
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

      {/* Status filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {statusFilters.map(s => {
          const active = (searchParams?.status ?? '') === s;
          return (
            <Link
              key={s}
              href={`/admin/sms${s ? `?status=${s}` : ''}` as any}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition"
              style={active
                ? { background: '#1F7BA8', color: '#fff' }
                : { background: '#131B27', color: '#94A3B8', border: '1px solid #1A2437' }
              }
            >
              {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </Link>
          );
        })}
      </div>

      {fetchError ? (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: '#2D0D0D', border: '1px solid #3D1515', color: '#EF4444' }}>
          {fetchError}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl p-12" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <EmptyState title="No SMS batches" description="Batches will appear here when SMS escalation is used." />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {['Batch', 'Status', 'Total', 'Delivered', 'Failed', 'Points', 'Created'].map((h, idx) => (
                  <th
                    key={h}
                    className={`px-4 py-3 text-[10px] font-semibold uppercase tracking-wider ${idx >= 2 ? 'text-right' : 'text-left'}`}
                    style={{ color: '#475569' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((b, i) => (
                <tr
                  key={b.id}
                  className="transition hover:bg-white/[0.03]"
                  style={i < rows.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}}
                >
                  <td className="px-4 py-3">
                    <Link href={`/admin/sms/${b.id}` as any} className="block">
                      <div className="font-mono text-[11px] hover:underline" style={{ color: '#5BB6DE' }}>{b.id.slice(0, 14)}…</div>
                      {b.conversationId && (
                        <div className="text-[10px] mt-0.5" style={{ color: '#475569' }}>
                          group: {b.conversationId.slice(0, 10)}
                        </div>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                  <td className="px-4 py-3 text-right font-mono text-[11px]" style={{ color: '#94A3B8' }}>{b.totalCount}</td>
                  <td className="px-4 py-3 text-right font-mono text-[11px]" style={{ color: '#22C55E' }}>{b.deliveredCount}</td>
                  <td className="px-4 py-3 text-right font-mono text-[11px]" style={{ color: '#EF4444' }}>{b.failedCount}</td>
                  <td className="px-4 py-3 text-right font-mono text-[11px]" style={{ color: '#94A3B8' }}>{b.pointsCost}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-[11px]" style={{ color: '#475569' }}>{b.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <div className="px-4 py-3 text-center" style={{ borderTop: `1px solid ${BORDER}` }}>
              <Link
                href={`/admin/sms?cursor=${nextCursor}${searchParams?.status ? `&status=${searchParams.status}` : ''}` as any}
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
