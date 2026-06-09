// Admin broadcast notifications — server component (Phase 28).
//
// Replaces the earlier "draft-only" foundation with the real
// notificationBroadcasts pipeline. Compose + send through a client form that
// calls the broadcastActions server actions.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getAdminScope } from '@/lib/adminScope';
import { adminDb } from '@/lib/firebase-admin';
import { safeDate } from '@/lib/redaction';
import { listOrganizations } from '@/lib/adminData';
import { PermissionState } from '@/components/state';
import StatusBadge from '@/components/admin/StatusBadge';
import BroadcastForm from './BroadcastForm';
import { estimateAudience, createAndSendBroadcast } from '@/lib/broadcastActions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CARD   = 'var(--c-card)';
const BORDER = 'var(--c-border)';

export default async function NotificationsPage() {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/notifications');
  if (!canDo(session.role, 'view:broadcast_notifications')) {
    return <div className="p-8"><PermissionState title="Broadcast access required" description="Your role does not include broadcast notifications." /></div>;
  }

  const canManage = canDo(session.role, 'manage:broadcast_notifications');
  const scope = getAdminScope(session);
  const isSuper = scope.organizationId === undefined;

  // Load orgs for the picker (org-admin sees only their own).
  let orgOptions: { id: string; name: string }[] = [];
  try {
    const all = await listOrganizations();
    orgOptions = (isSuper ? all : all.filter(o => o.id === scope.organizationId))
      .map(o => ({ id: o.id ?? '', name: o.name }));
  } catch { /* soft-fail */ }

  // Recent broadcasts (scope: super = all, org-admin = own).
  type Row = { id: string; title: string; body: string; audienceType: string; status: string; estimatedUsers: number; sentDevices: number; failedDevices: number; createdAt: string };
  let rows: Row[] = [];
  try {
    let q = adminDb.collection('notificationBroadcasts').orderBy('createdAt', 'desc').limit(20) as FirebaseFirestore.Query;
    if (!isSuper) q = q.where('createdByUid', '==', session.user.uid);
    const snap = await q.get();
    rows = snap.docs.map(d => {
      const data = d.data();
      return {
        id:             d.id,
        title:          (data.title as string) ?? '—',
        body:           (data.body  as string) ?? '',
        audienceType:   (data.audience?.type as string) ?? '—',
        status:         (data.status as string) ?? 'unknown',
        estimatedUsers: (data.estimatedUsers as number) ?? 0,
        sentDevices:    (data.sentDevices as number) ?? 0,
        failedDevices:  (data.failedDevices as number) ?? 0,
        createdAt:      safeDate(data.createdAt),
      };
    });
  } catch { /* collection absent — empty list */ }

  return (
    <div className="p-6 space-y-5 max-w-4xl" style={{ color: 'var(--c-text)' }}>
      <div className="mb-2">
        <p className="text-[12px] font-medium mb-0.5" style={{ color: 'var(--c-text-3)' }}>Admin / Notifications</p>
        <h1 className="text-[22px] font-extrabold tracking-tight">Broadcast notifications</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--c-text-3)' }}>
          Send push notifications to users.
          {isSuper ? ' You can target all users, organizations, roles, or selected users.' : ' You can target users in your organization.'}
        </p>
      </div>

      {canManage ? (
        <div className="rounded-2xl p-6" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <BroadcastForm
            isSuper={isSuper}
            organizations={orgOptions}
            estimate={estimateAudience}
            send={createAndSendBroadcast}
          />
        </div>
      ) : (
        <div className="rounded-2xl p-6" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>Sending broadcasts requires the manage:broadcast_notifications capability.</p>
        </div>
      )}

      <div className="rounded-2xl p-5" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
        <h2 className="text-sm font-extrabold mb-4">Recent broadcasts</h2>
        {rows.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--c-text-4)' }}>No broadcasts yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-wide text-left" style={{ borderBottom: `1px solid ${BORDER}`, color: 'var(--c-text-4)' }}>
                  <th className="pb-2 pr-4">Title</th>
                  <th className="pb-2 pr-4">Audience</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4 text-right">Est. users</th>
                  <th className="pb-2 pr-4 text-right">Sent</th>
                  <th className="pb-2 pr-4 text-right">Failed</th>
                  <th className="pb-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((n, i) => (
                  <tr key={n.id} className="transition hover:bg-white/[0.03]" style={i < rows.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}}>
                    <td className="py-2.5 pr-4">
                      <div className="font-semibold truncate max-w-[260px]">{n.title}</div>
                      <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--c-text-4)' }}>{n.id.slice(0, 12)}…</div>
                    </td>
                    <td className="py-2.5 pr-4 text-xs capitalize" style={{ color: 'var(--c-text-2)' }}>{n.audienceType.replace(/_/g, ' ')}</td>
                    <td className="py-2.5 pr-4"><StatusBadge status={n.status} /></td>
                    <td className="py-2.5 pr-4 text-right font-mono text-[11px]">{n.estimatedUsers}</td>
                    <td className="py-2.5 pr-4 text-right font-mono text-[11px]" style={{ color: '#22C55E' }}>{n.sentDevices}</td>
                    <td className="py-2.5 pr-4 text-right font-mono text-[11px]" style={{ color: '#EF4444' }}>{n.failedDevices}</td>
                    <td className="py-2.5 text-xs whitespace-nowrap" style={{ color: 'var(--c-text-3)' }}>{n.createdAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
