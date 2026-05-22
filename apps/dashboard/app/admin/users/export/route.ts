// Users metadata export — GET /admin/users/export
// Gated by export:users. Max 1000 rows. Phones and emails redacted.
// No message bodies, no secrets.

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { safeDate, maskPhone, maskEmail } from '@/lib/redaction';
import { csvRow, buildCsvResponse, writeExportAudit, EXPORT_LIMIT } from '@/lib/exportHelper';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const sessionCookie = cookies().get('__session')?.value;
  const session = await verifySession(sessionCookie);
  if (session.state !== 'authorized') return new NextResponse('Unauthorized', { status: 401 });
  if (!canDo(session.role, 'export:users')) return new NextResponse('Forbidden', { status: 403 });

  const url    = new URL(request.url);
  const status = url.searchParams.get('status') || undefined;

  let q = adminDb.collection('users').orderBy('createdAt', 'desc').limit(EXPORT_LIMIT) as FirebaseFirestore.Query;
  if (status) q = q.where('status', '==', status);

  let snap: FirebaseFirestore.QuerySnapshot;
  try { snap = await q.get(); }
  catch { return new NextResponse('Query failed.', { status: 500 }); }

  const header = csvRow(['uid', 'displayName', 'username', 'email', 'phone', 'status', 'profileCompleted', 'smsOptOut', 'createdAt']);
  const lines: string[] = [header];

  for (const d of snap.docs) {
    const data = d.data();
    lines.push(csvRow([
      d.id,
      data.displayName ?? '',
      data.username ?? '',
      maskEmail(data.email ?? null, session.role),
      maskPhone(data.phoneNumber ?? null),
      data.status ?? 'active',
      data.profileCompleted === true ? 'true' : 'false',
      data.smsOptOut === true ? 'true' : 'false',
      safeDate(data.createdAt),
    ]));
  }

  await writeExportAudit(session, 'export.users', snap.size, { status });
  const filename = `users-export-${new Date().toISOString().slice(0, 10)}.csv`;
  return buildCsvResponse(lines, filename);
}
