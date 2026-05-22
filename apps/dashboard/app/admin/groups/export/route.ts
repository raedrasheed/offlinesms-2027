// Groups metadata export — GET /admin/groups/export
// Gated by export:groups. Max 1000 rows. No member contact info.

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
  if (!canDo(session.role, 'export:groups')) return new NextResponse('Forbidden', { status: 403 });

  const url    = new URL(request.url);
  const status = url.searchParams.get('status') || undefined;

  let q = adminDb.collection('conversations')
    .where('type', '==', 'group')
    .orderBy('createdAt', 'desc')
    .limit(EXPORT_LIMIT) as FirebaseFirestore.Query;
  if (status) q = q.where('status', '==', status);

  let snap: FirebaseFirestore.QuerySnapshot;
  try { snap = await q.get(); }
  catch { return new NextResponse('Query failed.', { status: 500 }); }

  const header = csvRow(['id', 'name', 'status', 'memberCount', 'organizationId', 'ownerUid', 'createdAt', 'updatedAt']);
  const lines: string[] = [header];

  for (const d of snap.docs) {
    const data = d.data();
    const pids = Array.isArray(data.participantUids) ? data.participantUids : [];
    lines.push(csvRow([
      d.id,
      data.name ?? '',
      data.status ?? 'active',
      pids.length,
      data.organizationId ?? '',
      data.ownerUid ?? '',
      safeDate(data.createdAt),
      safeDate(data.updatedAt),
    ]));
  }

  await writeExportAudit(session, 'export.groups', snap.size, { status });
  const filename = `groups-export-${new Date().toISOString().slice(0, 10)}.csv`;
  return buildCsvResponse(lines, filename);
}
