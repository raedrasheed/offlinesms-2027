import Link from 'next/link';
import { getClipAdminStats, listAdminClips } from '@/lib/clipAdminData';
import { CLIP_STATUSES } from '@/lib/clipAdminPolicy';

const label = (v: string) => v.replace(/_/g, ' ');
const box = { background: 'var(--c-card)', border: '1px solid var(--c-border)' };
export default async function ClipsPage({ searchParams: searchParamsPromise }: { searchParams?: Promise<{ status?: string; ownerUid?: string; cursor?: string }> }) {
  const searchParams = (await searchParamsPromise) ?? {};
  const status = searchParams.status ?? 'pending_review';
  const ownerUid = searchParams.ownerUid?.trim() ?? '';
  const [page, stats] = await Promise.all([
    listAdminClips({ status, ownerUid, cursor: searchParams.cursor }), getClipAdminStats(),
  ]);
  const next = new URLSearchParams({ status, ownerUid, ...(page.nextCursor ? { cursor: page.nextCursor } : {}) });
  return <>
    <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
      {[
        ['Total videos', stats.total.toLocaleString()], ['Published', stats.published.toLocaleString()],
        ['Awaiting review', stats.pending.toLocaleString()], ['Open reports', stats.openReports.toLocaleString()],
        ['Stored media', `${(stats.storageBytes / 1024 / 1024).toFixed(1)} MB`], ['Unique clip views', stats.views.toLocaleString()],
      ].map(([name, value]) => <div key={name} className="rounded-xl p-4" style={box}><p className="text-xs" style={{ color: 'var(--c-text-3)' }}>{name}</p><p className="text-xl font-bold mt-2">{value}</p></div>)}
    </div>
    <form method="get" className="rounded-xl p-4 flex flex-wrap gap-3 items-end" style={box}>
      <label className="text-xs font-semibold">Status<select name="status" defaultValue={status} className="block mt-1 rounded-lg border p-2 text-sm" style={{ background: 'var(--c-bg)', borderColor: 'var(--c-border)' }}>
        <option value="">All statuses</option>{CLIP_STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}
      </select></label>
      <label className="text-xs font-semibold flex-1 min-w-[200px]">Creator UID (exact)<input name="ownerUid" defaultValue={ownerUid} maxLength={128} placeholder="Paste a creator UID" className="block w-full mt-1 rounded-lg border p-2 text-sm" style={{ background: 'var(--c-bg)', borderColor: 'var(--c-border)' }} /></label>
      <button className="rounded-lg px-5 py-2 text-sm font-bold text-white" style={{ background: '#1F7BA8' }}>Filter</button>
      <Link href={'/admin/clips?status=' as any} className="px-2 py-2 text-sm underline">Clear</Link>
    </form>
    {page.items.length === 0 ? <div className="rounded-xl py-16 text-center" style={box}><h2 className="font-bold">No clips in this view</h2><p className="text-sm mt-2" style={{ color: 'var(--c-text-3)' }}>New submissions appear here after upload and processing.</p></div> :
      <div className="rounded-xl overflow-auto" style={box}><table className="w-full text-sm text-left"><thead><tr style={{ color: 'var(--c-text-3)', borderBottom: '1px solid var(--c-border)' }}>
        {['Video / creator', 'Audience', 'Status', 'Duration', 'Views', 'Stored', 'Submitted', ''].map((h, i) => <th key={i} className="p-3 font-semibold">{h}</th>)}
      </tr></thead><tbody>{page.items.map(clip => <tr key={clip.id} style={{ borderBottom: '1px solid var(--c-border)' }}>
        <td className="p-3 max-w-sm"><Link href={`/admin/clips/${clip.id}` as any} className="font-semibold hover:underline line-clamp-2">{clip.caption || 'Untitled clip'}</Link><p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>{clip.ownerName || 'Unnamed creator'}</p><p className="text-[10px] font-mono mt-1">{clip.ownerUid}</p></td>
        <td className="p-3 capitalize">{clip.audience}</td><td className="p-3"><span className="rounded-full px-2 py-1 text-xs whitespace-nowrap capitalize" style={{ background: clip.status === 'pending_review' ? '#FEF3C7' : 'var(--c-bg)', color: clip.status === 'pending_review' ? '#92400E' : 'inherit' }}>{label(clip.status)}</span></td>
        <td className="p-3 whitespace-nowrap">{(clip.durationMs / 1000).toFixed(0)} s</td><td className="p-3">{clip.viewCount.toLocaleString()}</td><td className="p-3 whitespace-nowrap">{(clip.storageBytes / 1024 / 1024).toFixed(1)} MB</td>
        <td className="p-3 whitespace-nowrap text-xs">{clip.createdAtMs ? new Date(clip.createdAtMs).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC' : '—'}</td><td className="p-3"><Link href={`/admin/clips/${clip.id}` as any} className="font-bold" style={{ color: '#1F7BA8' }}>Review</Link></td>
      </tr>)}</tbody></table></div>}
    <div className="flex justify-between text-sm"><Link href={`/admin/clips?${new URLSearchParams({ status, ownerUid })}` as any} className="underline">First page</Link>{page.nextCursor && <Link href={`/admin/clips?${next}` as any} className="font-semibold underline">Next page →</Link>}</div>
    <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>Storage totals are recorded media bytes, not CDN traffic or a billing estimate. Views count one authenticated viewer per clip.</p>
  </>;
}
