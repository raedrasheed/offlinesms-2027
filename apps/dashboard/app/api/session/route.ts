import { clearDashboardSession, exchangeDashboardSession } from '@/lib/dashboardSessionResponse';
import { isAdminClaims } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  return exchangeDashboardSession(request, claims =>
    isAdminClaims(claims) === 'organization_admin' ? 'organization_portal_required' : null,
  );
}

export const DELETE = clearDashboardSession;
