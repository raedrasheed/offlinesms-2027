// SMS batch list export — GET /admin/sms/export
// Gated by export:sms. Max 1000 rows.
// No SMS body, no gateway payload, no phone numbers.

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
  if (!canDo(session.role, 'export:sms')) return new NextResponse('Forbidden', { status: 403 });

  const rl = checkRateLimit(`export:${session.user.uid}`, LIMITS.export);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs!);

  const url    = new URL(request.url);
  const status = url.searchParams.get('status') || undefined;

  let q = adminDb.collection('smsBatches').orderBy('createdAt', 'desc').limit(EXPORT_LIMIT) as FirebaseFirestore.Query;
  if (status) q = q.where('status', '==', status);

  let snap: FirebaseFirestore.QuerySnapshot;
  try { snap = await q.get(); }
  catch { return new NextResponse('Query failed.', { status: 500 }); }

  const header = csvRow(['id', 'status', 'totalCount', 'sentCount', 'deliveredCount', 'failedCount', 'skippedCount', 'pointsCost', 'attemptNumber', 'createdAt']);
  const lines: string[] = [header];

  for (const d of snap.docs) {
    const data = d.data();
    lines.push(csvRow([
      d.id,
      data.status ?? 'unknown',
      data.totalCount ?? 0,
      data.sentCount ?? 0,
      data.deliveredCount ?? 0,
      data.failedCount ?? 0,
      data.skippedCount ?? 0,
      data.pointsCost ?? 0,
      data.attemptNumber ?? 1,
      safeDate(data.createdAt),
    ]));
  }

  await writeExportAudit(session, 'export.sms', snap.size, { status });
  const filename = `sms-batches-export-${new Date().toISOString().slice(0, 10)}.csv`;
  return buildCsvResponse(lines, filename);
}
