// Admin audit log — server component.
// Supports server-side filters: actor, action, targetType, result, from, to.
// Raw payload fields are never rendered; only metadata field count is shown.
//
// Index requirements:
// - Single-field filters with orderBy(createdAt) require composite indexes.
// - Supported without indexes: unfiltered list, result-only, severity-only.
// - For production use: add composite indexes for each filter+createdAt combo.

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
  targetType?: string;
  targetId?: string;
  result?: string;
  severity?: string;
  createdAt?: Timestamp | null;
  payloadFieldCount?: number;
};

type AuditFilters = {
  actor?: string;
  action?: string;
  targetType?: string;
  result?: string;
  from?: string;
  to?: string;
  cursor?: string;
};

async function fetchAuditLogs(filters: AuditFilters): Promise<{ entries: AuditEntry[]; indexError: boolean }> {
  let q = adminDb.collection('auditLogs').orderBy('createdAt', 'desc').limit(50);

  // Apply a single equality filter to avoid index explosion.
  // Date-range filters are applied via inequality operators on createdAt.
  // Only one equality filter at a time to stay within composite-index budget.
  let indexError = false;
  try {
    if (filters.result)     q = q.where('result',     '==', filters.result)     as typeof q;
    if (filters.targetType) q = q.where('targetType', '==', filters.targetType) as typeof q;
    if (filters.action)     q = q.where('action',     '==', filters.action)     as typeof q;
    if (filters.actor)      q = q.where('actorUid',   '==', filters.actor)      as typeof q;

    if (filters.from) {
      const fromDate = new Date(filters.from);
      if (!isNaN(fromDate.getTime())) {
        q = q.where('createdAt', '>=', Timestamp.fromDate(fromDate)) as typeof q;
      }
    }
    if (filters.to) {
      const toDate = new Date(filters.to);
      if (!isNaN(toDate.getTime())) {
        toDate.setDate(toDate.getDate() + 1); // inclusive end-of-day
        q = q.where('createdAt', '<', Timestamp.fromDate(toDate)) as typeof q;
      }
    }

    if (filters.cursor) {
      const snap = await adminDb.collection('auditLogs').doc(filters.cursor).get();
      if (snap.exists) q = q.startAfter(snap);
    }

    const result = await q.get();
    return {
      entries: result.docs.map(d => {
        const data = d.data();
        return {
          id:                d.id,
          actorUid:          data.actorUid,
          actorEmail:        data.actorEmail,
          action:            data.action ?? '—',
          targetType:        data.targetType,
          targetId:          data.targetId,
          result:            data.result,
          severity:          data.severity,
          createdAt:         data.createdAt ?? null,
          payloadFieldCount: data.metadata ? Object.keys(data.metadata).length : 0,
        };
      }),
      indexError: false,
    };
  } catch (e: any) {
    // Firestore will throw if a composite index is missing.
    const isMissingIndex = e?.code === 9 || (e?.message ?? '').includes('index');
    if (isMissingIndex) return { entries: [], indexError: true };
    throw e;
  }
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
  searchParams?: {
    cursor?: string; actor?: string; action?: string;
    targetType?: string; result?: string; from?: string; to?: string;
  };
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

  const filters: AuditFilters = {
    actor:      searchParams?.actor      || undefined,
    action:     searchParams?.action     || undefined,
    targetType: searchParams?.targetType || undefined,
    result:     searchParams?.result     || undefined,
    from:       searchParams?.from       || undefined,
    to:         searchParams?.to         || undefined,
    cursor:     searchParams?.cursor     || undefined,
  };

  let entries: AuditEntry[] = [];
  let fetchError: string | null = null;
  let indexError = false;
  try {
    const res = await fetchAuditLogs(filters);
    entries = res.entries;
    indexError = res.indexError;
  } catch (e: any) {
    fetchError = e?.message ?? 'Failed to load audit log.';
  }

  const hasFilters = !!(filters.actor || filters.action || filters.targetType || filters.result || filters.from || filters.to);

  const canExport = canDo(session.role, 'export:audit');

  function buildExportHref() {
    const p = new URLSearchParams();
    if (filters.actor)      p.set('actor',      filters.actor);
    if (filters.action)     p.set('action',     filters.action);
    if (filters.targetType) p.set('targetType', filters.targetType);
    if (filters.result)     p.set('result',     filters.result);
    if (filters.from)       p.set('from',       filters.from);
    if (filters.to)         p.set('to',         filters.to);
    const qs = p.toString();
    return `/admin/audit/export${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="p-7">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-900">Audit Log</h1>
          <p className="text-sm text-ink-500 mt-0.5">Read-only record of administrative actions. Payload contents are not shown.</p>
        </div>
        {canExport && (
          <a
            href={buildExportHref()}
            className="shrink-0 px-4 py-2 bg-surface3 border border-ink-200 text-ink-700 text-sm font-bold rounded-lg hover:bg-ink-100 transition"
          >
            Export CSV
          </a>
        )}
      </div>

      {/* Filters */}
      <form method="GET" className="flex flex-wrap gap-3 mb-5">
        <input
          name="actor"
          defaultValue={filters.actor ?? ''}
          placeholder="Actor UID"
          className="bg-white border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none text-ink-700 w-40"
        />
        <input
          name="action"
          defaultValue={filters.action ?? ''}
          placeholder="Action (e.g. admin.wallet.frozen)"
          className="bg-white border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none text-ink-700 w-56"
        />
        <input
          name="targetType"
          defaultValue={filters.targetType ?? ''}
          placeholder="Target type"
          className="bg-white border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none text-ink-700 w-36"
        />
        <select
          name="result"
          defaultValue={filters.result ?? ''}
          className="bg-white border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none text-ink-700"
        >
          <option value="">Any result</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
        </select>
        <input
          name="from"
          type="date"
          defaultValue={filters.from ?? ''}
          className="bg-white border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none text-ink-700"
        />
        <input
          name="to"
          type="date"
          defaultValue={filters.to ?? ''}
          className="bg-white border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none text-ink-700"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary-dark transition"
        >
          Filter
        </button>
        {hasFilters && (
          <a href="/admin/audit" className="px-4 py-2 bg-surface3 text-ink-600 text-sm font-bold rounded-lg hover:bg-ink-100 transition">
            Clear
          </a>
        )}
      </form>

      {indexError && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-700 mb-4">
          This filter combination requires a Firestore composite index that has not been deployed. Try fewer simultaneous filters or use the date range alone.
        </div>
      )}

      {fetchError ? (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{fetchError}</div>
      ) : entries.length === 0 && !indexError ? (
        <div className="rounded-xl bg-surface3 border border-ink-100 p-8 text-center text-sm text-ink-500">
          {hasFilters ? 'No entries match the current filters.' : 'No audit log entries yet.'}
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
                <th className="px-4 py-3">Result</th>
                <th className="px-4 py-3 text-right">Metadata fields</th>
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
                    {entry.targetType
                      ? <span>{entry.targetType}{entry.targetId ? <span className="font-mono ml-1 text-ink-400">·{entry.targetId.slice(0, 8)}</span> : null}</span>
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      entry.result === 'failure' ? 'bg-red-50 text-red-700'
                      : entry.result === 'success' ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-gray-50 text-gray-600'
                    }`}>
                      {entry.result ?? '—'}
                    </span>
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
            href={`/admin/audit?cursor=${entries[entries.length - 1].id}${filters.actor ? `&actor=${filters.actor}` : ''}${filters.action ? `&action=${filters.action}` : ''}${filters.targetType ? `&targetType=${filters.targetType}` : ''}${filters.result ? `&result=${filters.result}` : ''}${filters.from ? `&from=${filters.from}` : ''}${filters.to ? `&to=${filters.to}` : ''}`}
            className="text-sm text-primary font-semibold hover:underline"
          >
            Load older entries →
          </a>
        </div>
      )}
    </div>
  );
}
