import Link from 'next/link';
import { listAdminClipReports } from '@/lib/clipAdminData';
import ClipReportReview from './ClipReportReview';
export default async function ClipReportsPage({ searchParams = {} }: { searchParams?: { status?: string; cursor?: string } }) {
  const status = searchParams.status ?? 'open';
  const page = await listAdminClipReports({ status, cursor: searchParams.cursor });
  return <>
    <div className="flex flex-wrap items-center gap-2">{['open', 'resolved', 'dismissed', ''].map(value => <Link key={value} href={`/admin/clips/reports?status=${value}` as any} className="rounded-lg px-3 py-2 text-sm font-bold capitalize" style={{ background: status === value ? '#1F7BA8' : 'var(--c-card)', color: status === value ? '#fff' : 'var(--c-text)', border: '1px solid var(--c-border)' }}>{value || 'All reports'}</Link>)}</div>
    {page.items.length === 0 ? <div className="rounded-xl border p-12 text-center" style={{ background: 'var(--c-card)', borderColor: 'var(--c-border)' }}><h2 className="font-bold">No reports in this view</h2><p className="text-sm mt-2" style={{ color: 'var(--c-text-3)' }}>Reports from clips and comments appear here.</p></div> : <div className="space-y-4">{page.items.map(report => <ClipReportReview key={`${report.id}:${report.version}`} report={report} />)}</div>}
    <div className="flex justify-between text-sm"><Link href={`/admin/clips/reports?status=${status}` as any} className="underline">First page</Link>{page.nextCursor && <Link href={`/admin/clips/reports?${new URLSearchParams({ status, cursor: page.nextCursor })}` as any} className="underline">Next page →</Link>}</div>
  </>;
}
