// Read-only audit log — Phase 12 skeleton.
//
// Reads up to 50 recent auditLogs entries server-side via adminDb.
// Capability-gated: only roles with view:audit may access this page.
// Raw payload fields are never rendered; only metadata is shown.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { PermissionState } from '@/components/state';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type AuditEntry = {
  id: string;
  actorUid?: string;
  actorEmail?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  severity?: string;
  createdAt?: Timestamp | null;
  payloadFieldCount?: number;
};

async function fetchAuditLogs(cursor?: string): Promise<AuditEntry[]> {
  let q = adminDb
    .collection('auditLogs')
    .orderBy('createdAt', 'desc')
    .limit(50);

  if (cursor) {
    const snap = await adminDb.collection('auditLogs').doc(cursor).get();
    if (snap.exists) q = q.startAfter(snap);
  }

  const result = await q.get();
  return result.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      actorUid:   data.actorUid,
      actorEmail: data.actorEmail,
      action:     data.action ?? '—',
      resourceType: data.resourceType,
      resourceId:   data.resourceId,
      severity:     data.severity,
      createdAt:    data.createdAt ?? null,
      payloadFieldCount: data.payload ? Object.keys(data.payload).length : 0,
    };
  });
}

function fmtTs(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return '—';
  return ts.toDate().toLocaleString('en-US', {
    month: 'short', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

const SEVERITY_CLS: Record<string, string> = {
  info:     'bg-blue-50 text-blue-700',
  warn:     'bg-yellow-50 text-yellow-700',
  critical: 'bg-red-50 text-red-700',
};

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams?: { cursor?: string };
}) {
  const sessionCookie = cookies().get('__session')?.value;
  const session = await verifySession(sessionCookie);

  if (session.state !== 'authorized') redirect('/login?next=/admin/audit');

  if (!canDo(session.role, 'view:audit')) {
    return (
      <div className="p-8">
        <PermissionState
          title="Audit log unavailable"
          description="Your role does not include access to the audit log."
        />
      </div>
    );
  }

  let entries: AuditEntry[] = [];
  let fetchError: string | null = null;
  try {
    entries = await fetchAuditLogs(searchParams?.cursor);
  } catch (e: any) {
    fetchError = e?.message ?? 'Failed to load audit log.';
  }

  return (
    <div className="p-7">
      <div className="mb-6">
        <h1 className="text-xl font-extrabold tracking-tight text-ink-900">Audit Log</h1>
        <p className="text-sm text-ink-500 mt-0.5">Read-only record of administrative actions.</p>
      </div>

      {fetchError ? (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{fetchError}</div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl bg-surface3 border border-ink-100 p-8 text-center text-sm text-ink-500">
          No audit log entries yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-surface3 text-left text-xs font-bold text-ink-500 tracking-wide uppercase">
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Resource</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3 text-right">Payload fields</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr
                  key={entry.id}
                  className={`border-t border-ink-100 ${i % 2 === 0 ? 'bg-white' : 'bg-surface3/40'}`}
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-ink-500 whitespace-nowrap">
                    {fmtTs(entry.createdAt)}
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-semibold text-ink-900 text-xs truncate max-w-[140px]">
                      {entry.actorEmail ?? entry.actorUid ?? '—'}
                    </p>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs text-ink-700">{entry.action}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-ink-500">
                    {entry.resourceType
                      ? <span>{entry.resourceType}{entry.resourceId ? <span className="font-mono ml-1 text-ink-400">·{entry.resourceId.slice(0, 8)}</span> : null}</span>
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {entry.severity ? (
                      <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${SEVERITY_CLS[entry.severity] ?? 'bg-gray-50 text-gray-600'}`}>
                        {entry.severity}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-ink-400">
                    {entry.payloadFieldCount ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {entries.length === 50 && (
        <div className="mt-4 text-center">
          <a
            href={`/admin/audit?cursor=${entries[entries.length - 1].id}`}
            className="text-sm text-primary font-semibold hover:underline"
          >
            Load older entries →
          </a>
        </div>
      )}
    </div>
  );
}
