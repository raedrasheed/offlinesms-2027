import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getOrganization } from '@/lib/adminData';
import { updateOrganization } from '@/lib/orgActions';
import { PermissionState } from '@/components/state';
import OrgForm from '@/components/admin/OrgForm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function EditOrgPage({ params }: { params: { orgId: string } }) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect(`/login?next=/admin/organizations/${params.orgId}/edit`);
  if (!canDo(session.role, 'manage:organizations')) {
    return <div className="p-8"><PermissionState title="Organization management required" /></div>;
  }

  const org = await getOrganization(params.orgId);
  if (!org) notFound();

  const updateBound = updateOrganization.bind(null, params.orgId);

  return (
    <div className="p-7 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href={'/admin/organizations' as any} className="text-sm text-ink-500 hover:text-ink-900">
          ← Organizations
        </Link>
        <span className="text-ink-300">/</span>
        <Link href={`/admin/organizations/${params.orgId}` as any} className="text-sm text-ink-500 hover:text-ink-900">
          {org.name}
        </Link>
        <span className="text-ink-300">/</span>
        <span className="text-sm font-semibold text-ink-900">Edit</span>
      </div>
      <h1 className="text-xl font-extrabold tracking-tight text-ink-900 mb-6">Edit — {org.name}</h1>
      <OrgForm
        action={updateBound}
        submitLabel="Save changes"
        initial={{
          name:            org.name,
          slug:            org.slug,
          status:          org.status,
          ownerUid:        org.ownerUid,
          smsEnabled:      org.smsEnabled,
          pointsEnabled:   org.pointsEnabled,
          defaultLanguage: org.settings.defaultLanguage as string,
          timezone:        org.settings.timezone as string,
        }}
      />
    </div>
  );
}
