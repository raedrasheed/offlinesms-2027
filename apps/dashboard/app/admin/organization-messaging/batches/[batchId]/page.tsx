// Organization Messaging — batch detail (summary + per-recipient logs).
//
// SCOPE: the route param is never trusted. The batch is loaded first, then its
// organizationId is checked against the session scope server-side
// (canAccessBatch): org-scoped admins only see their own organization's
// batches; unrestricted (super/legacy/bootstrap) admins see any.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getAdminScope } from '@/lib/adminScope';
import { canAccessBatch } from '@/lib/orgMessagingApi';
import { getOrganization } from '@/lib/adminData';
import { getOrgMessageBatch, listBatchMessages, MESSAGE_ROWS_MAX } from '@/lib/orgMessagingData';
import { PermissionState, EmptyState } from '@/components/state';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CARD   = 'var(--c-card)';
const BORDER = 'var(--c-border)';

function fmt(iso: string): string {
  return iso ? iso.replace('T', ' ').slice(0, 19) : '—';
}

const STATUS_COLORS: Record<string, string> = {
  accepted: '#22C55E', partial: '#F59E0B', failed: '#EF4444',
  queued: '#22C55E', unsupported_recipient: '#F59E0B',
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'var(--c-text-3)';
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ color, background: `${color}1f` }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export default async function OrgBatchDetailPage({
  params,
}: {
  params: { batchId: string };
}) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/organization-messaging');
  if (!canDo(session.role, 'view:organization_messaging')) {
    return <div className="p-8"><PermissionState title="Organization messaging access required" /></div>;
  }

  const batch = await getOrgMessageBatch(params.batchId);
  if (!batch) {
    return <div className="p-8"><PermissionState title="Batch not found" /></div>;
  }

  // Server-side org scoping — the batch's own organizationId is what counts.
  const scope = getAdminScope(session);
  if (!canAccessBatch(scope.organizationId, batch.organizationId)) {
    return <div className="p-8"><PermissionState title="Not available" description="This batch belongs to another organization." /></div>;
  }

  const [orgName, messages] = await Promise.all([
    getOrganization(batch.organizationId).then(o => o?.name ?? batch.organizationId).catch(() => batch.organizationId),
    listBatchMessages(batch.id),
  ]);

  return (
    <div className="p-6 max-w-5xl space-y-5" style={{ color: 'var(--c-text)' }}>
      <div>
        <div className="flex items-center gap-3 mb-2">
          <Link
            href={`/admin/organization-messaging?org=${batch.organizationId}` as any}
            className="text-sm"
            style={{ color: 'var(--c-text-3)' }}
          >
            ← Organization messaging
          </Link>
          <span style={{ color: 'var(--c-text-4)' }}>/</span>
          <span className="text-sm font-semibold font-mono">{batch.id.slice(0, 12)}…</span>
        </div>
        <h1 className="text-[22px] font-extrabold tracking-tight">Message batch</h1>
        <p className="text-[13px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>{orgName}</p>
      </div>

      {/* Batch summary */}
      <section className="rounded-2xl p-6" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-extrabold tracking-tight">Summary</h2>
          <StatusBadge status={batch.status} />
        </div>
        <div className="grid grid-cols-4 gap-4 mb-4">
          <Stat label="Total" value={batch.total} />
          <Stat label="Accepted (queued)" value={batch.accepted} />
          <Stat label="Failed" value={batch.failed} />
          <Stat label="Unsupported" value={batch.unsupported} />
        </div>
        <div className="grid grid-cols-4 gap-4 text-sm">
          <Meta label="Source" value={batch.source} />
          <Meta label="Created by" value={batch.source === 'api' ? `API key ${batch.createdBy.slice(0, 8)}…` : batch.createdBy.slice(0, 12) + '…'} mono />
          <Meta label="Created" value={fmt(batch.createdAt)} />
          <Meta label="Completed" value={fmt(batch.completedAt)} />
        </div>
      </section>

      {/* Per-recipient logs */}
      <section className="rounded-2xl overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between px-6 pt-6 pb-3">
          <h2 className="text-sm font-extrabold tracking-tight">Messages ({messages.length})</h2>
          {batch.total > MESSAGE_ROWS_MAX ? (
            <span className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>Showing the latest {MESSAGE_ROWS_MAX} rows</span>
          ) : null}
        </div>
        {messages.length === 0 ? (
          <div className="px-6 pb-6"><EmptyState title="No message rows" /></div>
        ) : (
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr style={{ borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
                {['Recipient', 'Type', 'Title', 'Body', 'Status', 'Failure reason', 'Created'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--c-text-4)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {messages.map((m, i) => (
                <tr key={m.id} style={i < messages.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}}>
                  <td className="px-4 py-2.5 font-mono text-[11px]">{m.recipientValue}</td>
                  <td className="px-4 py-2.5 capitalize">{m.recipientType}</td>
                  <td className="px-4 py-2.5 max-w-[160px] truncate">{m.title}</td>
                  <td className="px-4 py-2.5 max-w-[240px] truncate" style={{ color: 'var(--c-text-2)' }}>{m.body}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={m.status} /></td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--c-text-4)' }}>{m.failureReason ?? '—'}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--c-text-4)' }}>{fmt(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--c-text-4)' }}>{label}</p>
      <p className="text-lg font-extrabold mt-0.5">{value}</p>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--c-text-4)' }}>{label}</p>
      <p className={`text-sm font-semibold mt-0.5 capitalize ${mono ? 'font-mono normal-case' : ''}`}>{value}</p>
    </div>
  );
}
