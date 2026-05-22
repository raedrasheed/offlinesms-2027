// Admin role detail — server component. Shows user + current role.
// Role assignment available to manage:roles (super_admin only).

import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAuth } from 'firebase-admin/auth';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getUser } from '@/lib/adminData';
import { maskEmail } from '@/lib/redaction';
import { PermissionState } from '@/components/state';
import DetailCard from '@/components/admin/DetailCard';
import MetadataList from '@/components/admin/MetadataList';
import RoleBadge from '@/components/RoleBadge';
import RoleAssignAction from './RoleAssignAction';
import type { AdminRole } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function RoleDetailPage({ params }: { params: { uid: string } }) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/roles');
  if (!canDo(session.role, 'view:roles')) {
    return <div className="p-8"><PermissionState title="Roles access required" /></div>;
  }

  const [user, authUser] = await Promise.all([
    getUser(params.uid),
    getAuth().getUser(params.uid).catch(() => null),
  ]);

  if (!user || !authUser) notFound();

  const claims = (authUser.customClaims ?? {}) as Record<string, unknown>;
  const currentRole = typeof claims.role === 'string' ? claims.role : null;
  const isLegacyAdmin = claims.admin === true;
  const canManage = canDo(session.role, 'manage:roles') && params.uid !== session.user.uid;

  return (
    <div className="p-7 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href={'/admin/roles' as any} className="text-sm text-ink-500 hover:text-ink-900">← Roles</Link>
        <span className="text-ink-300">/</span>
        <span className="text-sm font-semibold text-ink-900 truncate">{user.displayName ?? params.uid}</span>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <div className="w-12 h-12 rounded-full bg-primary/20 text-primary font-bold text-xl grid place-items-center shrink-0">
          {(user.displayName ?? params.uid).slice(0, 1).toUpperCase()}
        </div>
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-900">{user.displayName ?? '—'}</h1>
          <p className="text-sm text-ink-500">{maskEmail(user.email, session.role)}</p>
        </div>
        {currentRole && <RoleBadge role={currentRole as AdminRole} />}
      </div>

      <div className="grid gap-5">
        <DetailCard title="Current claims">
          <MetadataList items={[
            { label: 'Role',         value: currentRole ?? '—' },
            { label: 'Legacy admin', value: isLegacyAdmin ? 'Yes' : 'No' },
            { label: 'UID',          value: <span className="font-mono text-[11px]">{params.uid}</span> },
          ]} />
        </DetailCard>

        {canManage ? (
          <DetailCard title="Assign role" subtitle="Changes are audit-logged. You cannot modify your own role.">
            <RoleAssignAction targetUid={params.uid} currentRole={currentRole} />
            <p className="text-xs text-ink-400 mt-3">
              Removing the last super_admin is blocked. Legacy admin claim is not affected by this form.
            </p>
          </DetailCard>
        ) : (
          <DetailCard title="Role assignment">
            <p className="text-sm text-ink-500">
              {params.uid === session.user.uid
                ? 'You cannot modify your own role.'
                : 'Only super admins can assign roles.'}
            </p>
          </DetailCard>
        )}
      </div>
    </div>
  );
}
