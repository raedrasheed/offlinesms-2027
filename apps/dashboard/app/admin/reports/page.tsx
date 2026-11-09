import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { PermissionState } from '@/components/state';
import { parseAnalyticsRange } from '@/lib/analytics';
import AnalyticsConsole from './AnalyticsConsole';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export default async function ReportsPage({ searchParams }: { searchParams?: Promise<{ range?: string }> }) {
  const session = await verifySession((await cookies()).get('__session')?.value);
  if (session.state !== 'authorized') redirect('/login?next=/admin/reports');
  if (!canDo(session.role, 'view:reports')) return <div className="p-8"><PermissionState title="Reports access required" description="Your role does not include access to reports." /></div>;
  return <AnalyticsConsole initialRange={parseAnalyticsRange((await searchParams)?.range)} />;
}
