// Dedicated "Send SMS" page — a focused form to send one SMS via an org's relay
// device. Org-scoped: super admins pick the org; org admins use their own.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getAdminScope } from '@/lib/adminScope';
import { listOrganizations } from '@/lib/adminData';
import { ADMIN_LABELS } from '@/lib/i18n';
import { PermissionState } from '@/components/state';
import SendSmsForm from './SendSmsForm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

  return (
    <div className="p-6 space-y-5" style={{ color: 'var(--c-text)' }}>
      <div>
        <h1 className="text-xl font-semibold">{ADMIN_LABELS.relay.sendTitle}</h1>
        <p className="text-sm" style={{ color: 'var(--c-text-muted)' }}>{ADMIN_LABELS.relay.sendHint}</p>
      </div>
      <SendSmsForm businessId={businessId} orgOptions={orgOptions} />
    </div>
  );
}
