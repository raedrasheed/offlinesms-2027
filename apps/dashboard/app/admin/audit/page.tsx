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

const CARD   = 'var(--c-card)';
const BORDER = 'var(--c-border)';

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

const RESULT_STYLE: Record<string, { bg: string; color: string }> = {
  success: { bg: 'var(--c-success-bg)', color: '#22C55E' },
  failure: { bg: 'var(--c-error-bg)', color: '#EF4444' },
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

  const inputStyle = 'rounded-lg px-3 py-2 text-[12px] outline-none';
  const inputSx = { background: 'var(--c-card)', border: '1px solid var(--c-border)', color: 'var(--c-text)' };

  return (
    <div className="p-6 space-y-5" style={{ color: 'var(--c-text)' }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[12px] font-medium mb-0.5" style={{ color: 'var(--c-text-3)' }}>Admin / Audit</p>
          <h1 className="text-[22px] font-extrabold tracking-tight">Audit Log</h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>Read-only record of administrative actions. Payload contents are not shown.</p>
        </div>
        {canExport && (
          <a
            href={buildExportHref()}
            className="shrink-0 px-4 py-2 text-sm font-bold rounded-lg transition hover:brightness-110"
            style={{ background: '#0A1828', color: '#5BB6DE', border: '1px solid #0E3A5A' }}
          >
            Export CSV
          </a>
        )}
      </div>

      {/* Filters */}
      <form method="GET" className="flex flex-wrap gap-2">
        <input name="actor"      defaultValue={filters.actor ?? ''}      placeholder="Actor UID"                          className={inputStyle} style={inputSx} />
        <input name="action"     defaultValue={filters.action ?? ''}     placeholder="Action (e.g. admin.wallet.frozen)"  className={`${inputStyle} w-56`} style={inputSx} />
        <input name="targetType" defaultValue={filters.targetType ?? ''} placeholder="Target type"                       className={`${inputStyle} w-36`} style={inputSx} />
        <select name="result" defaultValue={filters.result ?? ''} className={inputStyle} style={inputSx}>
          <option value="">Any result</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
        </select>
        <input name="from" type="date" defaultValue={filters.from ?? ''} className={inputStyle} style={inputSx} />
        <input name="to"   type="date" defaultValue={filters.to ?? ''}   className={inputStyle} style={inputSx} />
        <button
          type="submit"
          className="px-4 py-2 text-sm font-bold rounded-lg transition hover:brightness-110"
          style={{ background: '#1F7BA8', color: '#fff' }}
        >
          Filter
        </button>
        {hasFilters && (
          <a
            href="/admin/audit"
            className="px-4 py-2 text-sm font-bold rounded-lg transition"
            style={{ background: 'var(--c-card)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}
          >
            Clear
          </a>
        )}
      </form>

      {indexError && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--c-warning-bg)', border: '1px solid var(--c-warning-border)', color: '#F59E0B' }}>
          This filter combination requires a Firestore composite index that has not been deployed. Try fewer simultaneous filters or use the date range alone.
        </div>
      )}

      {fetchError ? (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--c-error-bg)', border: '1px solid var(--c-error-border)', color: '#EF4444' }}>
          {fetchError}
        </div>
      ) : entries.length === 0 && !indexError ? (
        <div className="rounded-xl p-8 text-center text-sm" style={{ background: CARD, border: `1px solid ${BORDER}`, color: 'var(--c-text-3)' }}>
          {hasFilters ? 'No entries match the current filters.' : 'No audit log entries yet.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {['Timestamp', 'Actor', 'Action', 'Resource', 'Result', 'Metadata fields'].map((h, idx) => (
                  <th
                    key={h}
                    className={`px-4 py-3 text-[10px] font-semibold uppercase tracking-wider ${idx === 5 ? 'text-right' : 'text-left'}`}
                    style={{ color: 'var(--c-text-4)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr
                  key={entry.id}
                  className="transition hover:bg-white/[0.03]"
                  style={i < entries.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}}
                >
                  <td className="px-4 py-2.5 font-mono text-[11px] whitespace-nowrap" style={{ color: 'var(--c-text-4)' }}>
                    {fmtTs(entry.createdAt)}
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-semibold text-[11px] truncate max-w-[140px]" style={{ color: 'var(--c-text)' }}>
                      {entry.actorEmail ?? entry.actorUid ?? '—'}
                    </p>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px]" style={{ color: 'var(--c-text-2)' }}>{entry.action}</span>
                  </td>
                  <td className="px-4 py-2.5 text-[11px]" style={{ color: 'var(--c-text-3)' }}>
                    {entry.targetType
                      ? <span>{entry.targetType}{entry.targetId ? <span className="font-mono ml-1" style={{ color: 'var(--c-text-4)' }}>·{entry.targetId.slice(0, 8)}</span> : null}</span>
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {(() => {
                      const s = RESULT_STYLE[entry.result ?? ''] ?? { bg: 'var(--c-border)', color: 'var(--c-text-2)' };
                      return (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.color }}>
                          {entry.result ?? '—'}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[11px]" style={{ color: 'var(--c-text-4)' }}>
                    {entry.payloadFieldCount ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {entries.length === 50 && (
        <div className="text-center">
          <a
            href={`/admin/audit?cursor=${entries[entries.length - 1].id}${filters.actor ? `&actor=${filters.actor}` : ''}${filters.action ? `&action=${filters.action}` : ''}${filters.targetType ? `&targetType=${filters.targetType}` : ''}${filters.result ? `&result=${filters.result}` : ''}${filters.from ? `&from=${filters.from}` : ''}${filters.to ? `&to=${filters.to}` : ''}`}
            className="text-sm font-semibold hover:underline"
            style={{ color: '#5BB6DE' }}
          >
            Load older entries →
          </a>
        </div>
      )}
    </div>
  );
}
