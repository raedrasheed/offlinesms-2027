// Content moderation foundation — server component.
// Reads the flags collection. Shows flagId, type, targetType, targetId (truncated),
// status, and createdAt. No private content, no message bodies.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { adminDb } from '@/lib/firebase-admin';
import { safeDate } from '@/lib/redaction';
import { PermissionState, EmptyState } from '@/components/state';
import StatusBadge from '@/components/admin/StatusBadge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type FlagRow = {
  id: string;
  type: string;
  targetType: string;
  targetId: string;
  status: string;
  createdAt: string;
};

async function fetchFlags(status?: string): Promise<FlagRow[]> {
  let q = adminDb.collection('flags').orderBy('createdAt', 'desc').limit(50) as FirebaseFirestore.Query;
  if (status) q = q.where('status', '==', status);
  const snap = await q.get();
  return snap.docs.map(d => {
    const data = d.data();
    const rawTargetId = (data.targetId as string | null) ?? '';
    return {
      id:         d.id,
      type:       (data.type       as string | null) ?? '—',
      targetType: (data.targetType as string | null) ?? '—',
      targetId:   rawTargetId.slice(0, 16),
      status:     (data.status     as string | null) ?? 'open',
      createdAt:  safeDate(data.createdAt),
    };
  });
}

export default async function ModerationPage({
  searchParams,
}: {
  searchParams?: { status?: string };
}) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/moderation');
  if (!canDo(session.role, 'view:moderation')) {
    return (
      <div className="p-8">
        <PermissionState
          title="Moderation access required"
          description="Your role does not include access to the moderation queue."
        />
      </div>
    );
  }

  const statusFilter = searchParams?.status ?? '';

  let flags: FlagRow[] = [];
  let fetchError: string | null = null;
  try {
    flags = await fetchFlags(statusFilter || undefined);
  } catch (e: any) {
    fetchError = e?.message ?? 'Failed to load flags.';
  }

  const STATUS_TABS = [
    { label: 'All',      value: '' },
    { label: 'Open',     value: 'open' },
    { label: 'Reviewed', value: 'reviewed' },
    { label: 'Dismissed', value: 'dismissed' },
  ];

  const CARD = '#131B27';
  const BORDER = '#1A2437';

  return (
    <div className="p-6 space-y-5" style={{ color: '#E2E8F2' }}>
      <div className="mb-6">
        <p className="text-[12px] font-medium mb-0.5" style={{ color: '#64748B' }}>Admin / Moderation</p>
        <h1 className="text-[22px] font-extrabold tracking-tight">Moderation</h1>
        <p className="text-sm mt-0.5" style={{ color: '#64748B' }}>Content flags and reports. No private content is displayed here.</p>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 mb-5">
        {STATUS_TABS.map(t => (
          <a
            key={t.value}
            href={t.value ? `/admin/moderation?status=${t.value}` : '/admin/moderation'}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition"
            style={
              statusFilter === t.value
                ? { background: '#1F7BA8', color: '#fff' }
                : { background: '#131B27', color: '#94A3B8', border: `1px solid ${BORDER}` }
            }
          >
            {t.label}
          </a>
        ))}
      </div>

      {fetchError ? (
        <div className="rounded-xl p-4 text-sm" style={{ background: '#2D0D0D', border: '1px solid #3D1515', color: '#EF4444' }}>{fetchError}</div>
      ) : flags.length === 0 ? (
        <div className="rounded-xl p-12" style={{ border: `1px solid ${BORDER}`, background: CARD }}>
          <EmptyState
            title="No flags found"
            description={statusFilter ? 'No flags match the current filter.' : 'No content flags have been submitted yet.'}
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ border: `1px solid ${BORDER}`, background: CARD }}>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-[10px] font-bold tracking-wide uppercase" style={{ borderBottom: `1px solid ${BORDER}`, color: '#475569' }}>
                <th className="px-4 py-3">Flag ID</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Flagged at</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f, i) => (
                <tr key={f.id} className="transition hover:bg-white/[0.03]" style={i < flags.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}}>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: '#475569' }}>{f.id.slice(0, 12)}…</td>
                  <td className="px-4 py-3 text-xs capitalize" style={{ color: '#94A3B8' }}>{f.type}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#64748B' }}>
                    <span className="capitalize">{f.targetType}</span>
                    {f.targetId && (
                      <span className="font-mono ml-1" style={{ color: '#475569' }}>·{f.targetId}</span>
                    )}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={f.status} /></td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: '#64748B' }}>{f.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
