// Admin SMS batch detail — server component.
// Phones masked. No SMS/message body shown.

import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getSmsBatch, listSmsBatchRecipients, listDeliveryEvents } from '@/lib/adminData';
import { maskPhone } from '@/lib/redaction';
import { PermissionState } from '@/components/state';
import DetailCard from '@/components/admin/DetailCard';
import MetadataList from '@/components/admin/MetadataList';
import StatusBadge from '@/components/admin/StatusBadge';
import SmsRetryAction from './SmsRetryAction';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CARD   = 'var(--c-card)';
const BORDER = 'var(--c-border)';

export default async function SmsBatchDetailPage({
  params,
  searchParams,
}: {
  params: { batchId: string };
  searchParams?: { cursor?: string };
}) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/sms');
  if (!canDo(session.role, 'view:sms')) {
    return <div className="p-8"><PermissionState title="SMS access required" /></div>;
  }

  const canRetry = canDo(session.role, 'retry:sms');

  const [batch, recipients, deliveryEvents] = await Promise.all([
    getSmsBatch(params.batchId),
    listSmsBatchRecipients(params.batchId, searchParams?.cursor),
    listDeliveryEvents(params.batchId).catch(() => []),
  ]);

  if (!batch) notFound();

  const nextCursor = recipients.length === 100 ? recipients[recipients.length - 1].uid : null;

  return (
    <div className="p-6 max-w-5xl space-y-5" style={{ color: 'var(--c-text)' }}>
      <div className="flex items-center gap-2 text-[12px]">
        <Link href={'/admin/sms' as any} className="hover:underline" style={{ color: '#5BB6DE' }}>← SMS Gateway</Link>
        <span style={{ color: 'var(--c-text-4)' }}>/</span>
        <span className="font-mono truncate" style={{ color: 'var(--c-text-3)' }}>{params.batchId.slice(0, 16)}…</span>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight">SMS Batch</h1>
          <p className="font-mono text-[11px] mt-0.5" style={{ color: 'var(--c-text-4)' }}>{params.batchId}</p>
        </div>
        <StatusBadge status={batch.status} />
      </div>

      <div className="grid gap-5">
        {/* Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {[
            { label: 'Total',     value: batch.totalCount,     color: 'var(--c-text)' },
            { label: 'Queued',    value: batch.queuedCount,    color: '#5BB6DE' },
            { label: 'Sent',      value: batch.sentCount,      color: 'var(--c-text-2)' },
            { label: 'Delivered', value: batch.deliveredCount, color: '#22C55E' },
            { label: 'Failed',    value: batch.failedCount,    color: '#EF4444' },
            { label: 'Skipped',   value: batch.skippedCount,   color: 'var(--c-text-4)' },
          ].map(s => (
            <div key={s.label} className="rounded-xl p-3 text-center" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
              <div className="text-2xl font-extrabold font-mono" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[10px] font-bold uppercase tracking-wide mt-1" style={{ color: 'var(--c-text-3)' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Metadata */}
        <DetailCard title="Batch metadata">
          <MetadataList columns={2} items={[
            { label: 'Batch ID',      value: <span className="font-mono text-[11px]">{params.batchId}</span> },
            { label: 'Conversation',  value: batch.conversationId ? (
              <Link href={`/admin/groups/${batch.conversationId}` as any} className="font-mono text-[11px] hover:underline" style={{ color: '#5BB6DE' }}>
                {batch.conversationId.slice(0, 16)}
              </Link>
            ) : '—' },
            { label: 'Sender',        value: batch.senderId ? (
              <Link href={`/admin/users/${batch.senderId}` as any} className="font-mono text-[11px] hover:underline" style={{ color: '#5BB6DE' }}>
                {batch.senderId.slice(0, 16)}
              </Link>
            ) : '—' },
            { label: 'Audience',      value: batch.audience ?? '—' },
            { label: 'Points cost',   value: String(batch.pointsCost) },
            { label: 'Attempt #',     value: String(batch.attemptNumber) },
            { label: 'Created',       value: batch.createdAt },
            { label: 'Updated',       value: batch.updatedAt },
          ]} />
        </DetailCard>

        {/* Retry action */}
        {batch.failedCount > 0 && (
          canRetry ? (
            <SmsRetryAction batchId={params.batchId} failedCount={batch.failedCount} />
          ) : (
            <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
              <div>
                <p className="text-sm font-bold" style={{ color: 'var(--c-text)' }}>
                  {batch.failedCount} failed recipient{batch.failedCount !== 1 ? 's' : ''}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>
                  Retry requires the retry:sms capability (super_admin or organization_admin).
                </p>
              </div>
              <button disabled className="px-3 py-1.5 text-xs font-bold rounded-lg cursor-not-allowed opacity-40" style={{ background: 'var(--c-border)', color: 'var(--c-text-2)' }}>
                Retry failed
              </button>
            </div>
          )
        )}

        {/* Recipients */}
        <DetailCard
          title={`Recipients (${recipients.length}${nextCursor ? '+' : ''})`}
          subtitle="Phones masked · no SMS body shown"
        >
          {recipients.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>No recipients loaded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className="text-left">
                    {['User', 'Phone (masked)', 'App receipt', 'SMS status', 'Skip/failure reason', 'Updated'].map(h => (
                      <th key={h} className="pb-2 pr-4 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--c-text-4)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recipients.map((r, i) => (
                    <tr
                      key={r.uid}
                      className="transition hover:bg-white/[0.03]"
                      style={{ borderTop: `1px solid ${BORDER}` }}
                    >
                      <td className="py-2.5 pr-4">
                        <Link href={`/admin/users/${r.uid}` as any} className="font-mono text-[11px] hover:underline" style={{ color: '#5BB6DE' }}>
                          {(r.displayName ?? r.uid).slice(0, 12)}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-[11px]" style={{ color: 'var(--c-text-2)' }}>{maskPhone(r.phone)}</td>
                      <td className="py-2.5 pr-4">
                        {r.appReceiptStatus ? <StatusBadge status={r.appReceiptStatus} /> : <span style={{ color: 'var(--c-text-4)' }}>—</span>}
                      </td>
                      <td className="py-2.5 pr-4">
                        {r.smsStatus ? <StatusBadge status={r.smsStatus} /> : <span style={{ color: 'var(--c-text-4)' }}>—</span>}
                      </td>
                      <td className="py-2.5 pr-4 text-[11px] max-w-[180px] truncate" style={{ color: 'var(--c-text-3)' }}>
                        {r.skipReason ?? r.failureReason ?? '—'}
                      </td>
                      <td className="py-2.5 text-[11px] whitespace-nowrap" style={{ color: 'var(--c-text-4)' }}>{r.updatedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {nextCursor && (
            <div className="mt-3 text-center">
              <Link href={`/admin/sms/${params.batchId}?cursor=${nextCursor}` as any} className="text-sm font-semibold hover:underline" style={{ color: '#5BB6DE' }}>
                Load more →
              </Link>
            </div>
          )}
        </DetailCard>

        {/* Webhook delivery events */}
        {deliveryEvents.length > 0 && (
          <DetailCard
            title={`Webhook delivery events (${deliveryEvents.length})`}
            subtitle="No raw payload, no phone number, no SMS body shown"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className="text-left">
                    {['Event ID', 'Status', 'Result', 'Error code', 'Received', 'Processed'].map(h => (
                      <th key={h} className="pb-2 pr-4 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--c-text-4)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deliveryEvents.map((ev, i) => (
                    <tr
                      key={ev.id}
                      className="transition hover:bg-white/[0.03]"
                      style={{ borderTop: `1px solid ${BORDER}` }}
                    >
                      <td className="py-2.5 pr-4 font-mono text-[11px]" style={{ color: 'var(--c-text-4)' }}>{ev.id.slice(0, 14)}…</td>
                      <td className="py-2.5 pr-4"><StatusBadge status={ev.status} /></td>
                      <td className="py-2.5 pr-4 text-[11px] capitalize" style={{ color: 'var(--c-text-2)' }}>{ev.result ?? '—'}</td>
                      <td className="py-2.5 pr-4 font-mono text-[11px]" style={{ color: 'var(--c-text-4)' }}>{ev.errorCode ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-[11px] whitespace-nowrap" style={{ color: 'var(--c-text-4)' }}>{ev.receivedAt}</td>
                      <td className="py-2.5 text-[11px] whitespace-nowrap" style={{ color: 'var(--c-text-4)' }}>{ev.processedAt ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DetailCard>
        )}
      </div>
    </div>
  );
}
