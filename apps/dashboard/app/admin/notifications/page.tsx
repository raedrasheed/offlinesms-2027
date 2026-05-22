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

  return (
    <div className="p-7 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-extrabold tracking-tight text-ink-900">Notifications</h1>
        <p className="text-sm text-ink-500 mt-0.5">Draft and preview broadcast announcements. Sending is disabled until infrastructure is ready.</p>
      </div>

      {canManage ? (
        <div className="bg-white rounded-2xl border border-ink-100 shadow-sh1 p-6 mb-8">
          <h2 className="text-sm font-extrabold text-ink-900 mb-4">New announcement draft</h2>
          <DraftForm action={saveDraftNotification} />
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-100 shadow-sh1 p-6 mb-8">
          <p className="text-sm text-ink-500">Drafting notifications requires the manage:notifications capability.</p>
        </div>
      )}

      {/* Recent drafts */}
      <div className="bg-white rounded-2xl border border-ink-100 shadow-sh1 p-5">
        <h2 className="text-sm font-extrabold text-ink-900 mb-4">
          Recent drafts {recentDrafts.length > 0 ? `(${recentDrafts.length})` : ''}
        </h2>
        {recentDrafts.length === 0 ? (
          <p className="text-sm text-ink-400">No notification drafts yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-[10px] font-bold text-ink-500 uppercase tracking-wide text-left">
                  <th className="pb-2 pr-4">Title</th>
                  <th className="pb-2 pr-4">Audience</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {recentDrafts.map((n, i) => (
                  <tr key={n.id} className={`border-t border-ink-100 ${i % 2 === 0 ? 'bg-white' : 'bg-surface3/40'}`}>
                    <td className="py-2.5 pr-4">
                      <div className="font-semibold text-ink-900 truncate max-w-[200px]">{n.title}</div>
                      <div className="text-[10px] font-mono text-ink-400 mt-0.5">{n.id.slice(0, 12)}…</div>
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-ink-600 capitalize">{n.audience}</td>
                    <td className="py-2.5 pr-4"><StatusBadge status={n.status} /></td>
                    <td className="py-2.5 text-xs text-ink-500 whitespace-nowrap">{n.createdAt}</td>
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
