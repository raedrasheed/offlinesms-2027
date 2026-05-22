// Admin notification broadcast foundation — server component.
// Allows drafting announcements with title, body, and audience.
// Broadcast sending is disabled until notification infrastructure is ready.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { adminDb } from '@/lib/firebase-admin';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { safeDate } from '@/lib/redaction';
import { PermissionState } from '@/components/state';
import StatusBadge from '@/components/admin/StatusBadge';
import DraftForm from './DraftForm';
import { saveDraftNotification } from './notificationActions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function NotificationsPage() {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/notifications');
  if (!canDo(session.role, 'view:notifications')) {
    return (
      <div className="p-8">
        <PermissionState title="Notifications access required" description="Your role does not include access to notifications." />
      </div>
    );
  }

  const canManage = canDo(session.role, 'manage:notifications');

  // Load most recent 10 drafts.
  let recentDrafts: { id: string; title: string; body: string; audience: string; status: string; createdAt: string }[] = [];
  try {
    const snap = await adminDb.collection('notifications')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();
    recentDrafts = snap.docs.map(d => {
      const data = d.data();
      return {
        id:        d.id,
        title:     (data.title    as string) ?? '—',
        body:      (data.body     as string) ?? '',
        audience:  (data.audience as string) ?? 'all',
        status:    (data.status   as string) ?? 'draft',
        createdAt: safeDate(data.createdAt),
      };
    });
  } catch { /* collection absent — ignore */ }

  const CARD = '#131B27';
  const BORDER = '#1A2437';

  return (
    <div className="p-6 space-y-5 max-w-3xl" style={{ color: '#E2E8F2' }}>
      <div className="mb-6">
        <p className="text-[12px] font-medium mb-0.5" style={{ color: '#64748B' }}>Admin / Notifications</p>
        <h1 className="text-[22px] font-extrabold tracking-tight">Notifications</h1>
        <p className="text-sm mt-0.5" style={{ color: '#64748B' }}>Draft and preview broadcast announcements. Sending is disabled until infrastructure is ready.</p>
      </div>

      {canManage ? (
        <div className="rounded-2xl p-6 mb-8" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <h2 className="text-sm font-extrabold mb-4" style={{ color: '#E2E8F2' }}>New announcement draft</h2>
          <DraftForm action={saveDraftNotification} />
        </div>
      ) : (
        <div className="rounded-2xl p-6 mb-8" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <p className="text-sm" style={{ color: '#64748B' }}>Drafting notifications requires the manage:notifications capability.</p>
        </div>
      )}

      {/* Recent drafts */}
      <div className="rounded-2xl p-5" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
        <h2 className="text-sm font-extrabold mb-4" style={{ color: '#E2E8F2' }}>
          Recent drafts {recentDrafts.length > 0 ? `(${recentDrafts.length})` : ''}
        </h2>
        {recentDrafts.length === 0 ? (
          <p className="text-sm" style={{ color: '#475569' }}>No notification drafts yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-wide text-left" style={{ borderBottom: `1px solid ${BORDER}`, color: '#475569' }}>
                  <th className="pb-2 pr-4">Title</th>
                  <th className="pb-2 pr-4">Audience</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {recentDrafts.map((n, i) => (
                  <tr key={n.id} className="transition hover:bg-white/[0.03]" style={i < recentDrafts.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}}>
                    <td className="py-2.5 pr-4">
                      <div className="font-semibold truncate max-w-[200px]" style={{ color: '#E2E8F2' }}>{n.title}</div>
                      <div className="text-[10px] font-mono mt-0.5" style={{ color: '#475569' }}>{n.id.slice(0, 12)}…</div>
                    </td>
                    <td className="py-2.5 pr-4 text-xs capitalize" style={{ color: '#94A3B8' }}>{n.audience}</td>
                    <td className="py-2.5 pr-4"><StatusBadge status={n.status} /></td>
                    <td className="py-2.5 text-xs whitespace-nowrap" style={{ color: '#64748B' }}>{n.createdAt}</td>
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
