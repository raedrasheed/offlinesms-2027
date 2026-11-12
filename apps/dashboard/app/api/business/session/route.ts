import { organizationClaim } from '@/lib/adminScope';
import { clearDashboardSession, exchangeDashboardSession } from '@/lib/dashboardSessionResponse';
import { isAdminClaims } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  return exchangeDashboardSession(request, claims => {
    const organizationId = organizationClaim(claims);
    if (isAdminClaims(claims) !== 'organization_admin' || !organizationId || organizationId.includes('/')) {
      return 'organization_access_required';
    }
    return null;
  });
}

export const DELETE = clearDashboardSession;
