import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { createOrganization } from '@/lib/orgActions';
import { PermissionState } from '@/components/state';
import OrgForm from '@/components/admin/OrgForm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function NewOrgPage() {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/organizations/new');
  if (!canDo(session.role, 'manage:organizations')) {
    return <div className="p-8"><PermissionState title="Organization management required" /></div>;
  }

  return (
    <div className="p-7 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href={'/admin/organizations' as any} className="text-sm text-ink-500 hover:text-ink-900">
          ← Organizations
        </Link>
        <span className="text-ink-300">/</span>
        <span className="text-sm font-semibold text-ink-900">New organization</span>
      </div>
      <h1 className="text-xl font-extrabold tracking-tight text-ink-900 mb-6">Create organization</h1>
      <OrgForm action={createOrganization} submitLabel="Create organization" />
    </div>
  );
}
