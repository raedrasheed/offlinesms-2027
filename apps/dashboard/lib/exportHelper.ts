// Shared CSV export helper for admin export routes.
// All exports: max 1000 rows, redacted fields, audited.

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import type { SessionResult } from './session';

export const EXPORT_LIMIT = 1000;

export function csvCell(v: string | number | boolean | null | undefined): string {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function csvRow(cells: (string | number | boolean | null | undefined)[]): string {
  return cells.map(csvCell).join(',');
}

export function buildCsvResponse(
  rows: string[],
  filename: string,
): Response {
  return new Response(rows.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export async function writeExportAudit(
  session: SessionResult & { state: 'authorized' },
  action: string,
  rowCount: number,
  filters: Record<string, string | undefined>,
): Promise<void> {
  try {
    await adminDb.collection('auditLogs').add({
      action,
      actorUid:   session.user.uid,
      actorEmail: session.user.email ?? null,
      targetType: 'export',
      targetId:   null,
      result:     'success',
      metadata:   { rowCount, filters },
      createdAt:  FieldValue.serverTimestamp(),
    });
  } catch { /* soft-fail */ }
}
