import Link from 'next/link';
import { listAdminPosts, listOpenPostReports } from '@/lib/postAdminData';
import { POST_STATUSES } from '@/lib/postAdminPolicy';
import { PostReportReview } from './PostReview';

const box={background:'var(--c-card)',borderColor:'var(--c-border)'};
export default async function PostsPage({searchParams}: {searchParams?:Promise<{status?:string;cursor?:string;view?:string}>}) {
  const params=(await searchParams)??{};
  if(params.view==='reports') {
    const page=await listOpenPostReports(params.cursor);
    return <><h2 className="font-bold">Open reports</h2><p className="text-sm">Review the post and apply any required content decision before resolving its report.</p>
      {page.items.length===0&&<p>No open reports.</p>}{page.items.map(report=><section key={report.id} className="rounded-xl border p-4 space-y-3" style={box}>
        <Link href={`/admin/posts/${report.postId}` as any} className="font-bold underline">Review post</Link><p>{report.reason}</p><p className="whitespace-pre-wrap">{report.details}</p><PostReportReview id={report.id} version={report.version}/>
      </section>)}<Link href={'/admin/posts?view=reports' as any} className="underline">First page</Link>{page.nextCursor&&<Link href={`/admin/posts?view=reports&cursor=${encodeURIComponent(page.nextCursor)}` as any} className="ml-5 underline">Next page</Link>}</>;
  }
  const status=(POST_STATUSES as readonly string[]).includes(params.status??'')?params.status!:'pending_review';
  const page=await listAdminPosts(status,params.cursor);
  return <><form className="flex gap-3"><select name="status" defaultValue={status} className="rounded-lg border p-2" style={box}>{POST_STATUSES.map(value=><option key={value} value={value}>{value.replace(/_/g,' ')}</option>)}</select><button className="rounded-lg border px-4" style={box}>Filter</button></form>
    {page.items.length===0&&<p>No posts in this view.</p>}{page.items.map(post=><article key={post.id} className="rounded-xl border p-4 space-y-2" style={box}>
      <Link href={`/admin/posts/${post.id}` as any} className="font-semibold underline line-clamp-3 whitespace-pre-wrap">{post.body||'Image post'}</Link>
      <p className="text-xs break-all" style={{color:'var(--c-text-3)'}}>{post.ownerUid} · {post.audience} · {post.createdAtMs?new Date(post.createdAtMs).toISOString():'—'}</p>
    </article>)}<div className="flex justify-between"><Link href={`/admin/posts?status=${status}` as any} className="underline">First page</Link>{page.nextCursor&&<Link href={`/admin/posts?status=${status}&cursor=${encodeURIComponent(page.nextCursor)}` as any} className="underline">Next page</Link>}</div>
  </>;
}
