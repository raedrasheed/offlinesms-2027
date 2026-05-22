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
    <div className="p-6 max-w-xl space-y-5" style={{ color: 'var(--c-text)' }}>
      <div className="flex items-center gap-2 text-[12px]">
        <Link href={'/admin/points/packages' as any} className="hover:underline" style={{ color: '#5BB6DE' }}>← Packages</Link>
        <span style={{ color: 'var(--c-text-4)' }}>/</span>
        <span className="font-semibold truncate" style={{ color: 'var(--c-text-3)' }}>{pkg.name}</span>
      </div>
      <h1 className="text-[22px] font-extrabold tracking-tight">Edit package</h1>
      <PackageForm action={boundAction} submitLabel="Save changes" initial={pkg} />
    </div>
  );
}
