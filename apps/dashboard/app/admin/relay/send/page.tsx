// Dedicated "Send SMS" page — a focused form to send one SMS via an org's relay
// device. Org-scoped: super admins pick the org; org admins use their own.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getAdminScope } from '@/lib/adminScope';
import { listOrganizations } from '@/lib/adminData';
import { adminDb } from '@/lib/firebase-admin';
import { ADMIN_LABELS } from '@/lib/i18n';
import { PermissionState } from '@/components/state';
import SendSmsForm from './SendSmsForm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function maskPhone(p: unknown): string {
  const s = typeof p === 'string' ? p.replace(/\s/g, '') : '';
  if (s.length < 4) return '•••';
  return `${s.slice(0, 4)} ••• ${s.slice(-3)}`;
}
const STATUS_COLOR: Record<string, string> = {
  delivered: '#166534', sent: '#15803D', sending: '#1D4ED8', claimed: '#1D4ED8',
  queued: '#92400E', failed: '#991B1B', expired: '#991B1B',
};

export default async function SendSmsPage({ searchParams }: { searchParams?: { org?: string } }) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/relay/send');
  if (!canDo(session.role, 'manage:relay')) {
    return <div className="p-8"><PermissionState title="Relay send access required" /></div>;
  }

  const scope = getAdminScope(session);
  const businessId = scope.organizationId ?? (searchParams?.org?.trim() || null);

  let orgOptions: { id: string; name: string }[] = [];
  if (scope.organizationId === undefined) {
    try { orgOptions = (await listOrganizations()).map(o => ({ id: o.id ?? '', name: o.name })); }
    catch { /* best-effort */ }
  }

  // Recent relay sends for this org (newest first). No orderBy → no composite
  // index needed; sorted in memory (low volume).
  type Recent = { id: string; phone: string; status: string; at: number | null; error: string | null };
  let recent: Recent[] = [];
  if (businessId) {
    try {
      const snap = await adminDb.collection('relayJobs').where('businessId', '==', businessId).limit(100).get();
      recent = snap.docs
        .map(d => ({
          id: d.id,
          phone: maskPhone(d.get('phoneE164')),
          status: (d.get('status') as string) ?? 'queued',
          at: (d.get('createdAt') as any)?.toMillis?.() ?? null,
          error: (d.get('lastError') as string) ?? null,
        }))
        .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
        .slice(0, 25);
    } catch { /* best-effort */ }
  }

  const box = { background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12, padding: 16 };

  return (
    <div className="p-6 space-y-5" style={{ color: 'var(--c-text)' }}>
      <div>
        <h1 className="text-xl font-semibold">{ADMIN_LABELS.relay.sendTitle}</h1>
        <p className="text-sm" style={{ color: 'var(--c-text-muted)' }}>{ADMIN_LABELS.relay.sendHint}</p>
      </div>
      <SendSmsForm businessId={businessId} orgOptions={orgOptions} />

      {businessId && (
        <div style={box}>
          <div className="font-medium mb-2">{ADMIN_LABELS.relay.recentTitle}</div>
          {recent.length === 0 ? (
            <div className="text-sm" style={{ color: 'var(--c-text-muted)' }}>{ADMIN_LABELS.relay.recentNone}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--c-text-muted)', textAlign: 'left' }}>
                  <th className="py-1 pr-4 font-medium">{ADMIN_LABELS.relay.recentTo}</th>
                  <th className="py-1 pr-4 font-medium">{ADMIN_LABELS.relay.recentStatus}</th>
                  <th className="py-1 pr-4 font-medium">{ADMIN_LABELS.relay.recentTime}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(r => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--c-border)' }}>
                    <td className="py-1.5 pr-4">{r.phone}</td>
                    <td className="py-1.5 pr-4" style={{ color: STATUS_COLOR[r.status] ?? 'inherit', fontWeight: 600 }}>
                      {r.status}{r.error ? ` · ${r.error}` : ''}
                    </td>
                    <td className="py-1.5 pr-4" style={{ color: 'var(--c-text-muted)' }}>
                      {r.at ? new Date(r.at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
