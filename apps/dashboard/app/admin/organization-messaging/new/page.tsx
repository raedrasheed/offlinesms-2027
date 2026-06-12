// Create an organization account — super-admin (platform) only.
// Gated by manage:organization_messaging AND an unrestricted scope, so an
// organization_admin can never reach it (they're org-scoped).

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getAdminScope } from '@/lib/adminScope';
import { createOrganizationAccount } from '@/lib/orgMessagingActions';
import { PermissionState } from '@/components/state';
import CreateOrgAccountForm from './CreateOrgAccountForm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function NewOrgAccountPage() {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/organization-messaging/new');

  const isPlatformAdmin = canDo(session.role, 'manage:organization_messaging')
    && getAdminScope(session).organizationId === undefined;
  if (!isPlatformAdmin) {
    return <div className="p-8"><PermissionState title="Super admin required" description="Only platform super admins can create organization accounts." /></div>;
  }

  return (
    <div className="p-7 max-w-2xl" style={{ color: 'var(--c-text)' }}>
      <div className="flex items-center gap-3 mb-6">
        <Link href={'/admin/organization-messaging' as any} className="text-sm" style={{ color: 'var(--c-text-3)' }}>
          ← Organization messaging
        </Link>
        <span style={{ color: 'var(--c-text-4)' }}>/</span>
        <span className="text-sm font-semibold">New account</span>
      </div>
      <h1 className="text-[22px] font-extrabold tracking-tight mb-1">Create organization account</h1>
      <p className="text-[13px] mb-6" style={{ color: 'var(--c-text-3)' }}>
        Creates the organization, its admin login (email + password), and scopes the admin to this organization only.
      </p>
      <CreateOrgAccountForm action={createOrganizationAccount} />
    </div>
  );
}
