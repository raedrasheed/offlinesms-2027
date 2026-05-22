// Audit log CSV export — GET /admin/audit/export
// Gated by export:audit capability.
// Hard-limited to 1 000 rows per request.
// Columns: id, timestamp, actorUid, actorEmail, action, targetType,
//          targetId (first 16 chars), result, metadataFieldCount
// No raw metadata values, no SMS body, no phone numbers, no secrets.
// Each successful export is audit-logged as audit.exported.

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { checkRateLimit, rateLimitResponse, LIMITS } from '@/lib/rateLimit';

export const runtime = 'nodejs';

const EXPORT_LIMIT = 1000;

function fmtTs(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return '';
  return ts.toDate().toISOString();
}

function csvCell(v: string | number | null | undefined): string {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',');
}

export async function GET(request: Request) {
  const sessionCookie = cookies().get('__session')?.value;
  const session = await verifySession(sessionCookie);

  if (session.state !== 'authorized') {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!canDo(session.role, 'export:audit')) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const rl = checkRateLimit(`audit-export:${session.user.uid}`, LIMITS.auditExport);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs!);

  const url = new URL(request.url);
  const actor      = url.searchParams.get('actor')      || undefined;
  const action     = url.searchParams.get('action')     || undefined;
  const targetType = url.searchParams.get('targetType') || undefined;
  const result     = url.searchParams.get('result')     || undefined;
  const from       = url.searchParams.get('from')       || undefined;
  const to         = url.searchParams.get('to')         || undefined;

  let q = adminDb.collection('auditLogs').orderBy('createdAt', 'desc').limit(EXPORT_LIMIT) as FirebaseFirestore.Query;

  if (result)     q = q.where('result',     '==', result);
  if (targetType) q = q.where('targetType', '==', targetType);
  if (action)     q = q.where('action',     '==', action);
  if (actor)      q = q.where('actorUid',   '==', actor);

  if (from) {
    const fromDate = new Date(from);
    if (!isNaN(fromDate.getTime())) {
      q = q.where('createdAt', '>=', Timestamp.fromDate(fromDate));
    }
  }
  if (to) {
    const toDate = new Date(to);
    if (!isNaN(toDate.getTime())) {
      toDate.setDate(toDate.getDate() + 1);
      q = q.where('createdAt', '<', Timestamp.fromDate(toDate));
    }
  }

  let snap: FirebaseFirestore.QuerySnapshot;
  try {
    snap = await q.get();
  } catch {
    return new NextResponse('Failed to query audit log.', { status: 500 });
  }

  const header = csvRow(['id', 'timestamp', 'actorUid', 'actorEmail', 'action', 'targetType', 'targetId', 'result', 'metadataFieldCount']);
  const lines: string[] = [header];

  for (const d of snap.docs) {
    const data = d.data();
    const targetId = typeof data.targetId === 'string' ? data.targetId.slice(0, 16) : '';
    const metadataFieldCount = data.metadata && typeof data.metadata === 'object'
      ? Object.keys(data.metadata).length
      : 0;
    lines.push(csvRow([
      d.id,
      fmtTs(data.createdAt),
      data.actorUid ?? '',
      data.actorEmail ?? '',
      data.action ?? '',
      data.targetType ?? '',
      targetId,
      data.result ?? '',
      metadataFieldCount,
    ]));
  }

  // Audit-log the export itself (soft-fail).
  try {
    await adminDb.collection('auditLogs').add({
      action:     'audit.exported',
      actorUid:   session.user.uid,
      actorEmail: session.user.email ?? null,
      targetType: 'audit-export',
      targetId:   null,
      result:     'success',
      metadata:   { rowCount: snap.size, filters: { actor, action, targetType, result, from, to } },
      createdAt:  FieldValue.serverTimestamp(),
    });
  } catch { /* soft-fail */ }

  const filename = `audit-export-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(lines.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
