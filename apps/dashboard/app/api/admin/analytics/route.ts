import { cookies } from 'next/headers';
import { verifySession } from '../../../../lib/session';
import { canDo } from '../../../../lib/adminPermissions';
import { getAnalyticsLive, getAnalyticsReport } from '../../../../lib/analyticsData';
import { ANALYTICS_RANGES, parseAnalyticsRange } from '../../../../lib/analytics';
import { checkRateLimit } from '../../../../lib/rateLimit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };
export async function GET(request: Request) {
  const session = await verifySession((await cookies()).get('__session')?.value);
  if (session.state === 'unauthenticated') return Response.json({ error: 'Sign in required' }, { status: 401, headers });
  if (session.state !== 'authorized' || !canDo(session.role, 'view:reports'))
    return Response.json({ error: 'Reports access required' }, { status: 403, headers });
  // Old admin:true claims must not expand a restricted explicit role here.
  const claims = session.user.claims;
  const explicit = typeof claims.role === 'string' ? claims.role : null;
  if (session.role === 'legacy_admin' && ((explicit && !['super_admin', 'legacy_admin'].includes(explicit))
    || (!explicit && Array.isArray(claims.roles) && claims.roles.length && !claims.roles.some(r => r === 'super_admin' || r === 'legacy_admin'))))
    return Response.json({ error: 'Refresh administrator permissions before opening analytics' }, { status: 403, headers });
  const params = new URL(request.url).searchParams;
  const raw = params.get('range'), kind = params.get('kind') ?? 'all';
  if ((raw !== null && !ANALYTICS_RANGES.some(r => r === raw)) || !['live', 'report', 'all'].includes(kind))
    return Response.json({ error: 'Use range=7d,30d,90d and kind=live,report,all' }, { status: 400, headers });
  const limit = checkRateLimit(`${session.user.uid}:analytics`, { maxRequests: 60, windowMs: 60_000 });
  if (!limit.ok) return Response.json({ error: 'Please wait before refreshing again' }, { status: 429,
    headers: { ...headers, 'Retry-After': String(Math.ceil((limit.retryAfterMs ?? 1000) / 1000)) } });
  try {
    if (kind === 'live') return Response.json({ live: await getAnalyticsLive(session) }, { headers });
    if (kind === 'report') return Response.json({ report: await getAnalyticsReport(session, parseAnalyticsRange(raw)) }, { headers });
    const [report, live] = await Promise.all([getAnalyticsReport(session, parseAnalyticsRange(raw)), getAnalyticsLive(session)]);
    return Response.json({ report, live }, { headers });
  } catch { return Response.json({ error: 'Analytics is temporarily unavailable' }, { status: 503, headers }); }
}
