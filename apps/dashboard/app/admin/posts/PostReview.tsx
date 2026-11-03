'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAdminPostImage, moderatePost, resolvePostReport } from '@/lib/postAdminActions';
import type { AdminPost } from '@/lib/postAdminData';
import type { PostModerationAction } from '@/lib/postAdminPolicy';

const inputStyle = {background:'var(--c-bg)',borderColor:'var(--c-border)',color:'var(--c-text)'};
export function PostReview({post}: {post: AdminPost}) {
  const router = useRouter();
  const [reason,setReason] = useState(''), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const [preview,setPreview] = useState<{url:string;expiresAtMs:number}|null>(null);
  useEffect(() => {setPreview(null);setError('');}, [post.id,post.version]);
  useEffect(() => {if (!preview) return; const timer = setTimeout(() => setPreview(null), Math.max(0,preview.expiresAtMs-Date.now())); return () => clearTimeout(timer);}, [preview]);
  async function image() {
    if (busy) return;
    setBusy(true);setError('');
    try {const result=await getAdminPostImage(post.id); if(result.error)setError(result.error); else if(result.url&&result.expiresAtMs)setPreview({url:result.url,expiresAtMs:result.expiresAtMs});}
    catch {setError('Could not load the image. Try again.');} finally {setBusy(false);}
  }
  async function decide(action:PostModerationAction) {
    if (busy) return;
    setBusy(true);setError('');
    try {const result=await moderatePost({postId:post.id,version:post.version,reason,action}); if(result.error)setError(result.error); else {setPreview(null);router.refresh();}}
    catch {setError('The decision was not saved. Try again.');} finally {setBusy(false);}
  }
  return <section className="rounded-2xl border p-5 space-y-4" style={{background:'var(--c-card)',borderColor:'var(--c-border)'}}>
    <p className="text-xs capitalize">{post.status.replace(/_/g,' ')} · {post.audience}</p>
    <p className="whitespace-pre-wrap break-words">{post.body || 'Image post'}</p>
    {post.hasImage&&post.status!=='removed'&&(preview
      // Signed review media is short-lived and never accepted from the browser.
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={preview.url} alt="Post submitted for review" className="max-h-[600px] max-w-full rounded-xl" onError={()=>{setPreview(null);setError('Image expired or unavailable. Load it again.');}} />
      : <button disabled={busy} onClick={()=>void image()} className="rounded-lg border px-4 py-2" style={inputStyle}>Load image preview</button>)}
    <p className="text-xs break-all" style={{color:'var(--c-text-3)'}}>Creator: {post.ownerUid} · {post.likeCount} likes · {post.commentCount} comments</p>
    {post.moderationReason&&<p className="text-sm">Previous decision: {post.moderationReason}</p>}
    {post.status!=='removed'&&<><label className="block text-sm">Decision reason<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} className="mt-2 w-full rounded-xl border p-3" style={inputStyle} /></label>
      <div className="flex gap-3 flex-wrap">{(post.status==='pending_review'?['approve','reject','remove']:['remove']).map(action=><button key={action} disabled={busy||reason.trim().length<3} onClick={()=>void decide(action as PostModerationAction)} className="rounded-lg border px-4 py-2 capitalize disabled:opacity-40" style={inputStyle}>{action}</button>)}</div></>}
    {busy&&<p role="status">Working…</p>}{error&&<p role="alert" className="text-red-600">{error}</p>}
  </section>;
}
export function PostReportReview({id,version}: {id:string;version:string}) {
  const router=useRouter();const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function decide(decision:'resolved'|'dismissed') {
    if(busy)return;setBusy(true);setError('');
    try {const result=await resolvePostReport({reportId:id,version,reason,decision});if(result.error)setError(result.error);else router.refresh();}
    catch {setError('The report could not be updated.');}finally{setBusy(false);}
  }
  return <div className="space-y-2"><input aria-label="Report decision reason" placeholder="Decision reason" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} className="w-full rounded-lg border px-3 py-2" style={inputStyle}/>
    <div className="flex gap-3"><button disabled={busy||reason.trim().length<3} onClick={()=>void decide('resolved')} className="underline disabled:opacity-40">Mark resolved</button><button disabled={busy||reason.trim().length<3} onClick={()=>void decide('dismissed')} className="underline disabled:opacity-40">Dismiss report</button></div>
    {error&&<p role="alert" className="text-red-600">{error}</p>}</div>;
}
