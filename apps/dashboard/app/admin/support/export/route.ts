// Support tickets export — GET /admin/support/export
// Gated by export:support. Max 1000 rows.
// Exports subject/category/status/createdBy (uid)/dates only.
// Does NOT export ticket description body.

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
  if (!canDo(session.role, 'export:support')) return new NextResponse('Forbidden', { status: 403 });

  const url      = new URL(request.url);
  const status   = url.searchParams.get('status')   || undefined;
  const category = url.searchParams.get('category') || undefined;

  let q = adminDb.collection('tickets').orderBy('createdAt', 'desc').limit(EXPORT_LIMIT) as FirebaseFirestore.Query;
  if (status)   q = q.where('status',   '==', status);
  if (category) q = q.where('category', '==', category);

  let snap: FirebaseFirestore.QuerySnapshot;
  try { snap = await q.get(); }
  catch { return new NextResponse('Query failed.', { status: 500 }); }

  // description body is intentionally excluded from export
  const header = csvRow(['id', 'subject', 'category', 'status', 'createdBy', 'createdAt', 'updatedAt']);
  const lines: string[] = [header];

  for (const d of snap.docs) {
    const data = d.data();
    lines.push(csvRow([
      d.id,
      data.subject ?? '',
      data.category ?? 'other',
      data.status ?? 'open',
      data.createdBy ?? '',
      safeDate(data.createdAt),
      safeDate(data.updatedAt),
    ]));
  }

  await writeExportAudit(session, 'export.support', snap.size, { status, category });
  const filename = `support-tickets-export-${new Date().toISOString().slice(0, 10)}.csv`;
  return buildCsvResponse(lines, filename);
}
