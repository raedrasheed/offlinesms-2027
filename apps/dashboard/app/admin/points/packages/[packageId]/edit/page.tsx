// Admin points package edit — server component.

import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getPointsPackage } from '@/lib/adminData';
import { PermissionState } from '@/components/state';
import PackageForm from '../../PackageForm';
import { updatePointsPackage } from '@/lib/packageActions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function EditPackagePage({ params }: { params: { packageId: string } }) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/points/packages');
  if (!canDo(session.role, 'manage:packages')) {
    return <div className="p-8"><PermissionState title="Package management access required" /></div>;
  }

  const pkg = await getPointsPackage(params.packageId);
  if (!pkg) notFound();

  const boundAction = updatePointsPackage.bind(null, params.packageId);

  return (
    <div className="p-7 max-w-xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href={'/admin/points/packages' as any} className="text-sm text-ink-500 hover:text-ink-900">← Packages</Link>
        <span className="text-ink-300">/</span>
        <span className="text-sm font-semibold text-ink-900 truncate">{pkg.name}</span>
      </div>
      <h1 className="text-xl font-extrabold tracking-tight text-ink-900 mb-5">Edit package</h1>
      <PackageForm action={boundAction} submitLabel="Save changes" initial={pkg} />
    </div>
  );
}
