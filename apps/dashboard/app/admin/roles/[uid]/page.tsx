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

  const CARD = '#131B27';
  const BORDER = '#1A2437';

  return (
    <div className="p-6 space-y-5 max-w-2xl" style={{ color: '#E2E8F2' }}>
      <div className="flex items-center gap-3 mb-6">
        <p className="text-[12px] font-medium mb-0.5" style={{ color: '#64748B' }}>Admin / Roles</p>
        <Link href={'/admin/roles' as any} className="text-sm hover:underline" style={{ color: '#64748B' }}>← Roles</Link>
        <span style={{ color: '#475569' }}>/</span>
        <span className="text-sm font-semibold truncate" style={{ color: '#E2E8F2' }}>{user.displayName ?? params.uid}</span>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <div className="w-12 h-12 rounded-full font-bold text-xl grid place-items-center shrink-0" style={{ background: 'rgba(91,182,222,0.15)', color: '#5BB6DE' }}>
          {(user.displayName ?? params.uid).slice(0, 1).toUpperCase()}
        </div>
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight">{user.displayName ?? '—'}</h1>
          <p className="text-sm" style={{ color: '#64748B' }}>{maskEmail(user.email, session.role)}</p>
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
            <p className="text-xs mt-3" style={{ color: '#475569' }}>
              Removing the last super_admin is blocked. Legacy admin claim is not affected by this form.
            </p>
          </DetailCard>
        ) : (
          <DetailCard title="Role assignment">
            <p className="text-sm" style={{ color: '#64748B' }}>
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
