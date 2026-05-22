// Admin SMS batch detail — server component.
// Phones masked. No SMS/message body. Retry action is deferred.

import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getSmsBatch, listSmsBatchRecipients } from '@/lib/adminData';
import { maskPhone } from '@/lib/redaction';
import { PermissionState } from '@/components/state';
import DetailCard from '@/components/admin/DetailCard';
import MetadataList from '@/components/admin/MetadataList';
import StatusBadge from '@/components/admin/StatusBadge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

  const [batch, recipients] = await Promise.all([
    getSmsBatch(params.batchId),
    listSmsBatchRecipients(params.batchId, searchParams?.cursor),
  ]);

  if (!batch) notFound();

  const nextCursor = recipients.length === 100 ? recipients[recipients.length - 1].uid : null;

  return (
    <div className="p-7 max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href={'/admin/sms' as any} className="text-sm text-ink-500 hover:text-ink-900">← SMS Gateway</Link>
        <span className="text-ink-300">/</span>
        <span className="text-sm font-mono text-ink-900 truncate">{params.batchId.slice(0, 16)}…</span>
      </div>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-900">SMS Batch</h1>
          <p className="text-xs font-mono text-ink-400 mt-0.5">{params.batchId}</p>
        </div>
        <StatusBadge status={batch.status} />
      </div>

      <div className="grid gap-5">
        {/* Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {[
            { label: 'Total',     value: batch.totalCount,     cls: '' },
            { label: 'Queued',    value: batch.queuedCount,    cls: 'text-blue-700' },
            { label: 'Sent',      value: batch.sentCount,      cls: 'text-ink-700' },
            { label: 'Delivered', value: batch.deliveredCount, cls: 'text-emerald-700' },
            { label: 'Failed',    value: batch.failedCount,    cls: 'text-red-700' },
            { label: 'Skipped',   value: batch.skippedCount,   cls: 'text-ink-400' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-ink-100 p-3 text-center">
              <div className={`text-2xl font-extrabold font-mono ${s.cls}`}>{s.value}</div>
              <div className="text-[10px] font-bold text-ink-500 uppercase tracking-wide mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Metadata */}
        <DetailCard title="Batch metadata">
          <MetadataList columns={2} items={[
            { label: 'Batch ID',      value: <span className="font-mono text-[11px]">{params.batchId}</span> },
            { label: 'Conversation',  value: batch.conversationId ? (
              <Link href={`/admin/groups/${batch.conversationId}` as any} className="font-mono text-[11px] text-primary hover:underline">
                {batch.conversationId.slice(0, 16)}
              </Link>
            ) : '—' },
            { label: 'Sender',        value: batch.senderId ? (
              <Link href={`/admin/users/${batch.senderId}` as any} className="font-mono text-[11px] text-primary hover:underline">
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

        {/* Retry action — deferred */}
        {(batch.failedCount > 0) && (
          <div className="rounded-xl border border-ink-100 bg-surface3/50 p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-ink-900">{batch.failedCount} failed recipient{batch.failedCount !== 1 ? 's' : ''}</p>
              <p className="text-xs text-ink-500">Retry via the mobile app. Dashboard retry is deferred to a later phase.</p>
            </div>
            <button disabled className="px-3 py-1.5 bg-ink-100 text-ink-400 text-xs font-bold rounded-lg cursor-not-allowed">
              Retry failed (coming later)
            </button>
          </div>
        )}

        {/* Recipients */}
        <DetailCard
          title={`Recipients (${recipients.length}${nextCursor ? '+' : ''})`}
          subtitle="Phones masked · no SMS body shown"
        >
          {recipients.length === 0 ? (
            <p className="text-sm text-ink-500">No recipients loaded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-[10px] font-bold text-ink-500 uppercase tracking-wide text-left">
                    <th className="pb-2 pr-4">User</th>
                    <th className="pb-2 pr-4">Phone (masked)</th>
                    <th className="pb-2 pr-4">App receipt</th>
                    <th className="pb-2 pr-4">SMS status</th>
                    <th className="pb-2 pr-4">Skip/failure reason</th>
                    <th className="pb-2">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {recipients.map((r, i) => (
                    <tr key={r.uid} className={`border-t border-ink-100 ${i % 2 === 0 ? '' : 'bg-surface3/40'}`}>
                      <td className="py-2.5 pr-4">
                        <Link href={`/admin/users/${r.uid}` as any} className="text-xs text-primary hover:underline font-mono">
                          {(r.displayName ?? r.uid).slice(0, 12)}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-ink-600">{maskPhone(r.phone)}</td>
                      <td className="py-2.5 pr-4">
                        {r.appReceiptStatus ? <StatusBadge status={r.appReceiptStatus} /> : <span className="text-ink-400">—</span>}
                      </td>
                      <td className="py-2.5 pr-4">
                        {r.smsStatus ? <StatusBadge status={r.smsStatus} /> : <span className="text-ink-400">—</span>}
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-ink-500 max-w-[180px] truncate">
                        {r.skipReason ?? r.failureReason ?? '—'}
                      </td>
                      <td className="py-2.5 text-xs text-ink-400 whitespace-nowrap">{r.updatedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {nextCursor && (
            <div className="mt-3 text-center">
              <Link href={`/admin/sms/${params.batchId}?cursor=${nextCursor}` as any}
                className="text-sm text-primary font-semibold hover:underline">
                Load more →
              </Link>
            </div>
          )}
        </DetailCard>
      </div>
    </div>
  );
}
