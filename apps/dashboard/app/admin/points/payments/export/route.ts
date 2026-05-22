// Payments export — GET /admin/points/payments/export
// Gated by export:points. Max 1000 rows. No payment secrets.

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { safeDate } from '@/lib/redaction';
import { csvRow, buildCsvResponse, writeExportAudit, EXPORT_LIMIT } from '@/lib/exportHelper';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const sessionCookie = cookies().get('__session')?.value;
  const session = await verifySession(sessionCookie);
  if (session.state !== 'authorized') return new NextResponse('Unauthorized', { status: 401 });
  if (!canDo(session.role, 'export:points')) return new NextResponse('Forbidden', { status: 403 });

  const url    = new URL(request.url);
  const status = url.searchParams.get('status') || undefined;

  let q = adminDb.collection('payments').orderBy('createdAt', 'desc').limit(EXPORT_LIMIT) as FirebaseFirestore.Query;
  if (status) q = q.where('status', '==', status);

  let snap: FirebaseFirestore.QuerySnapshot;
  try { snap = await q.get(); }
  catch { return new NextResponse('Query failed.', { status: 500 }); }

  const header = csvRow(['id', 'userId', 'packageId', 'totalPoints', 'amount', 'currency', 'status', 'createdAt']);
  const lines: string[] = [header];

  for (const d of snap.docs) {
    const data = d.data();
    lines.push(csvRow([
      d.id,
      data.userId ?? '',
      data.packageId ?? '',
      data.totalPoints ?? 0,
      data.amount ?? 0,
      data.currency ?? '',
      data.status ?? '',
      safeDate(data.createdAt),
    ]));
  }

  await writeExportAudit(session, 'export.payments', snap.size, { status });
  const filename = `payments-export-${new Date().toISOString().slice(0, 10)}.csv`;
  return buildCsvResponse(lines, filename);
}
