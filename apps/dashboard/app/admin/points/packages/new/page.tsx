// Admin points package create — server component shell.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { PermissionState } from '@/components/state';
import PackageForm from '../PackageForm';
import { createPointsPackage } from '@/lib/packageActions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function NewPackagePage() {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/points/packages/new');
  if (!canDo(session.role, 'manage:packages')) {
    return <div className="p-8"><PermissionState title="Package management access required" /></div>;
  }

  return (
    <div className="p-6 max-w-xl space-y-5" style={{ color: '#E2E8F2' }}>
      <div className="flex items-center gap-2 text-[12px]">
        <Link href={'/admin/points/packages' as any} className="hover:underline" style={{ color: '#5BB6DE' }}>← Packages</Link>
        <span style={{ color: '#475569' }}>/</span>
        <span style={{ color: '#64748B' }}>New package</span>
      </div>
      <h1 className="text-[22px] font-extrabold tracking-tight">Create points package</h1>
      <PackageForm action={createPointsPackage} submitLabel="Create package" />
    </div>
  );
}
