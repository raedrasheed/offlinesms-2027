import { cookies } from 'next/headers';
import { verifySession } from '../../../../lib/session';
import { canDo } from '../../../../lib/adminPermissions';
import { getDashboardOverview } from '../../../../lib/dashboardData';
import { checkRateLimit } from '../../../../lib/rateLimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };

export async function GET() {
  const session = await verifySession((await cookies()).get('__session')?.value);
  if (session.state === 'unauthenticated') return Response.json({ error: 'Sign in required' }, { status: 401, headers });
  if (session.state !== 'authorized' || !canDo(session.role, 'view:overview')) {
    return Response.json({ error: 'Overview access required' }, { status: 403, headers });
  }
  const limit = checkRateLimit(`${session.user.uid}:overview`, { maxRequests: 30, windowMs: 60_000 });
  if (!limit.ok) return Response.json({ error: 'Please wait before refreshing again' }, {
    status: 429, headers: { ...headers, 'Retry-After': String(Math.ceil((limit.retryAfterMs ?? 1000) / 1000)) },
  });
  try { return Response.json(await getDashboardOverview(session), { headers }); }
  catch { return Response.json({ error: 'Dashboard data is temporarily unavailable' }, { status: 503, headers }); }
}
