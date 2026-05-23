// Transactions export — GET /admin/points/transactions/export
// Gated by export:points. Max 1000 rows. No secrets.

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { safeDate } from '@/lib/redaction';
import { csvRow, buildCsvResponse, writeExportAudit, EXPORT_LIMIT } from '@/lib/exportHelper';
import { checkRateLimit, rateLimitResponse, LIMITS } from '@/lib/rateLimit';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const sessionCookie = cookies().get('__session')?.value;
  const session = await verifySession(sessionCookie);
  if (session.state !== 'authorized') return new NextResponse('Unauthorized', { status: 401 });
  if (!canDo(session.role, 'export:points')) return new NextResponse('Forbidden', { status: 403 });

  const rl = checkRateLimit(`export:${session.user.uid}`, LIMITS.export);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs!);

  const url  = new URL(request.url);
  const type = url.searchParams.get('type') || undefined;
  const uid  = url.searchParams.get('uid')  || undefined;

  let q = adminDb.collection('transactions').orderBy('createdAt', 'desc').limit(EXPORT_LIMIT) as FirebaseFirestore.Query;
  if (uid)  q = q.where('uid',  '==', uid);
  if (type) q = q.where('type', '==', type);

  let snap: FirebaseFirestore.QuerySnapshot;
  try { snap = await q.get(); }
  catch { return new NextResponse('Query failed.', { status: 500 }); }

  const header = csvRow(['id', 'uid', 'type', 'direction', 'amount', 'status', 'createdAt']);
  const lines: string[] = [header];

  for (const d of snap.docs) {
    const data = d.data();
    lines.push(csvRow([
      d.id,
      data.uid ?? '',
      data.type ?? '',
      data.direction ?? '',
      data.amount ?? 0,
      data.status ?? '',
      safeDate(data.createdAt),
    ]));
  }

  await writeExportAudit(session, 'export.transactions', snap.size, { type, uid });
  const filename = `transactions-export-${new Date().toISOString().slice(0, 10)}.csv`;
  return buildCsvResponse(lines, filename);
}
