import type { Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import StatusBadge from '@/components/admin/StatusBadge';
import { getAdminStatus } from '@/lib/statusAdminData';
import StatusReview from './StatusReview';

export default async function StatusDetailPage({ params }: { params: Promise<{ statusId: string }> }) {
  const { statusId } = await params;
  const status = await getAdminStatus(statusId);
  if (!status) notFound();
  return <section className="rounded-2xl p-6 space-y-4 max-w-3xl" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
    <Link href={'/admin/statuses' as Route} className="text-sm underline">← All statuses</Link>
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-xl font-bold" dir="auto">{status.authorName || 'Unnamed author'}</h2>
      <StatusBadge status={status.expired ? 'expired' : status.suspended ? 'suspended' : 'active'} />
    </div>
    <p className="text-sm capitalize" style={{ color: 'var(--c-text-3)' }}>
      {status.type} · {status.audience.replace(/_/g, ' ')} · {status.views} views · {status.likes} likes
    </p>
    <p className="text-xs break-all" style={{ color: 'var(--c-text-3)' }}>{status.id}</p>
    {status.body && <p dir="auto" className="whitespace-pre-wrap break-words rounded-lg p-4" style={{ background: 'var(--c-bg)' }}>{status.body}</p>}
    <StatusReview key={status.id} id={status.id} type={status.type} expired={status.expired} suspended={status.suspended} version={status.version} />
  </section>;
}
