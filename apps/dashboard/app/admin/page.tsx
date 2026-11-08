import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getDashboardOverview } from '@/lib/dashboardData';
import { PermissionState } from '@/components/state';
import DashboardOverview from './DashboardOverview';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function DashboardPage() {
  const session = await verifySession((await cookies()).get('__session')?.value);
  if (session.state !== 'authorized') redirect('/login?next=/admin');
  if (!canDo(session.role, 'view:overview')) return <PermissionState title="Overview access required" />;
  return <DashboardOverview key={JSON.stringify([session.user.uid, session.role, session.user.claims.organizationId])} initialData={await getDashboardOverview(session)} />;
}

