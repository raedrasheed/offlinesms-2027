import type { Route } from 'next';
import Link from 'next/link';
import StatusBadge from '@/components/admin/StatusBadge';
import { listAdminStatuses } from '@/lib/statusAdminData';

export default async function StatusesPage({ searchParams }: {
  searchParams: Promise<{ authorId?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const authorId = typeof params.authorId === 'string' ? params.authorId.trim() : '';
  const cursor = typeof params.cursor === 'string' ? params.cursor : undefined;
  const page = await listAdminStatuses(authorId, cursor).catch(() => null);
  const firstPage = `/admin/statuses${authorId ? `?authorId=${encodeURIComponent(authorId)}` : ''}` as Route;

  return <section className="rounded-2xl p-5 space-y-4" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
    <form className="flex flex-wrap items-end gap-2" action="/admin/statuses">
      <label className="text-sm font-semibold">Author UID
        <input name="authorId" defaultValue={authorId} maxLength={128} placeholder="Any author" className="block mt-1 px-3 py-2 rounded-lg border" style={{ background: 'var(--c-bg)', borderColor: 'var(--c-border)' }} />
      </label>
      <button className="rounded-lg px-4 py-2 text-white bg-sky-700 text-sm font-semibold">Filter</button>
      {authorId && <Link href={'/admin/statuses' as Route} className="px-3 py-2 text-sm underline">Clear filter</Link>}
    </form>
    {!page ? <p role="alert" className="text-sm">Could not load these statuses. <Link href={'/admin/statuses' as Route} className="underline">Return to the first page</Link>.</p>
      : page.items.length === 0 ? <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>No statuses found.</p>
      : <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead style={{ color: 'var(--c-text-3)' }}>
            <tr>{['Author', 'Type', 'Visibility', 'Published (UTC)', 'Expires (UTC)', 'Views / likes', 'Review'].map(column => <th key={column} scope="col" className="py-2 px-2 whitespace-nowrap">{column}</th>)}</tr>
          </thead>
          <tbody>
            {page.items.map(status => <tr key={status.id} style={{ borderTop: '1px solid var(--c-border)' }}>
              <td className="py-3 px-2"><p className="font-semibold" dir="auto">{status.authorName || 'Unnamed author'}</p><p className="text-xs break-all" style={{ color: 'var(--c-text-3)' }}>{status.authorId}</p></td>
              <td className="px-2 capitalize">{status.type}</td>
              <td className="px-2"><StatusBadge status={status.expired ? 'expired' : status.suspended ? 'suspended' : 'active'} /></td>
              <td className="px-2 whitespace-nowrap">{formatDate(status.createdAt)}</td>
              <td className="px-2 whitespace-nowrap">{formatDate(status.expiresAt)}</td>
              <td className="px-2 whitespace-nowrap">{status.views} / {status.likes}</td>
              <td className="px-2"><Link href={`/admin/statuses/${encodeURIComponent(status.id)}` as Route} className="underline">Review</Link></td>
            </tr>)}
          </tbody>
        </table>
      </div>}
    <nav aria-label="Status pages" className="flex gap-4 text-sm">
      {cursor && <Link href={firstPage} className="underline">First page</Link>}
      {page?.nextCursor && <Link href={`/admin/statuses?${new URLSearchParams({ ...(authorId ? { authorId } : {}), cursor: page.nextCursor })}` as Route} className="underline">Next page</Link>}
    </nav>
  </section>;
}

function formatDate(ms: number) {
  return ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '—';
}
