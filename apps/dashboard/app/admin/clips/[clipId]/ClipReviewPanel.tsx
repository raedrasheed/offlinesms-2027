'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AdminClipRow } from '@/lib/clipAdminData';
import type { ClipModerationAction } from '@/lib/clipAdminPolicy';
import { getAdminClipPreview, moderateClip, setClipPublisherSuspended } from '@/lib/clipAdminActions';
const box = { background: 'var(--c-card)', border: '1px solid var(--c-border)' };
export default function ClipReviewPanel({ clip }: { clip: AdminClipRow }) {
  const [url, setUrl] = useState<string | null>(null);
  const [expires, setExpires] = useState(0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  async function preview() {
    setBusy(true); setError(null);
    try {
      const result = await getAdminClipPreview(clip.id);
      if (result.error || !result.url) setError(result.error ?? 'Video is unavailable.');
      else { setUrl(result.url); setExpires(result.expiresAtMs ?? 0); }
    } catch { setError('Could not load the video. Try again.'); } finally { setBusy(false); }
  }
  async function moderate(action: ClipModerationAction) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await moderateClip({ clipId: clip.id, action, reason, version: clip.version });
      if (result?.error) setError(result.error);
      else { setMessage('Moderation decision saved.'); if (action === 'remove') setUrl(null); router.refresh(); }
    } catch { setError('Could not save the decision. Reload and try again.'); } finally { setBusy(false); }
  }
  async function suspend() {
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await setClipPublisherSuspended({ uid: clip.ownerUid, suspended: !clip.publisherSuspended, reason, version: clip.publisherVersion });
      if (result?.error) setError(result.error);
      else { setMessage('Clips access updated.'); router.refresh(); }
    } catch { setError('Could not update publisher permissions.'); } finally { setBusy(false); }
  }
  return <div className="grid lg:grid-cols-[minmax(260px,420px)_1fr] gap-5">
    <section className="rounded-2xl p-4 space-y-3" style={box}>
      <div className="rounded-xl bg-black aspect-[9/16] flex items-center justify-center overflow-hidden">
        {url ? <video key={url} src={url} controls controlsList="nodownload" playsInline preload="metadata" className="w-full h-full object-contain" onError={() => setError(Date.now() > expires ? 'Preview expired. Load a new preview to continue.' : 'Video playback failed. Load a new preview.')}><track kind="captions" /></video> : <p className="text-white/70 text-sm p-6 text-center">{clip.hasMedia ? 'Load a protected review preview.' : 'Video processing has not produced a playable file.'}</p>}
      </div>
      <button type="button" disabled={busy || !clip.hasMedia || clip.status === 'removed'} onClick={preview} className="w-full rounded-lg px-4 py-2 text-white font-semibold disabled:opacity-40" style={{ background: '#1F7BA8' }}>{busy ? 'Working…' : url ? 'Refresh preview' : 'Load video preview'}</button>
      <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>Preview access expires after two minutes. Loading private content is audit-logged.</p>
    </section>
    <section className="rounded-2xl p-6 space-y-5" style={box}>
      <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-xl font-bold">Review video</h2><span className="rounded-full bg-sky-50 text-sky-800 px-3 py-1 text-sm capitalize">{clip.status.replace(/_/g, ' ')}</span></div>
      <p className="whitespace-pre-wrap break-words text-lg" dir="auto">{clip.caption || 'No caption'}</p>
      <dl className="grid sm:grid-cols-2 gap-4 text-sm">{[
        ['Creator', clip.ownerName || 'Unnamed creator'], ['Creator UID', clip.ownerUid], ['Audience', clip.audience],
        ['Duration', `${(clip.durationMs / 1000).toFixed(1)} seconds`], ['Stored media', `${(clip.storageBytes / 1024 / 1024).toFixed(1)} MB`],
        ['Views / likes / comments', `${clip.viewCount} / ${clip.likeCount} / ${clip.commentCount}`],
      ].map(([name, value]) => <div key={name}><dt className="text-xs" style={{ color: 'var(--c-text-3)' }}>{name}</dt><dd className="font-semibold mt-1 break-all">{value}</dd></div>)}</dl>
      <Link href={`/admin/clips?status=&ownerUid=${encodeURIComponent(clip.ownerUid)}` as any} className="inline-block text-sm underline">View this creator’s clips</Link>
      {clip.moderationReason && <div className="rounded-lg p-3 text-sm" style={{ background: 'var(--c-bg)' }}><strong>Last decision</strong><p className="mt-1 whitespace-pre-wrap">{clip.moderationReason}</p></div>}
      {clip.processingError && <p role="status" className="text-sm text-red-600">Processing: {clip.processingError}</p>}
      {error && <p role="alert" className="rounded-lg p-3 text-red-700 bg-red-50">{error}</p>}
      {message && <p role="status" className="rounded-lg p-3 text-green-700 bg-green-50">{message}</p>}
      <label className="block text-sm font-semibold">Decision reason<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={3} maxLength={500} rows={3} placeholder="Describe the reason for the moderation or publishing decision." className="mt-2 w-full rounded-lg p-3 border" style={{ background: 'var(--c-bg)', borderColor: 'var(--c-border)' }} /></label>
      <div className="flex flex-wrap gap-2">
        {clip.status === 'pending_review' && <><button disabled={busy || reason.trim().length < 3} onClick={() => moderate('approve')} className="rounded-lg px-4 py-2 text-white bg-emerald-700 font-bold disabled:opacity-40">Approve & publish</button><button disabled={busy || reason.trim().length < 3} onClick={() => moderate('reject')} className="rounded-lg px-4 py-2 text-amber-900 bg-amber-100 font-bold disabled:opacity-40">Reject</button></>}
        {clip.status === 'published' && <button disabled={busy || reason.trim().length < 3} onClick={() => moderate('suspend')} className="rounded-lg px-4 py-2 text-amber-900 bg-amber-100 font-bold disabled:opacity-40">Suspend clip</button>}
        {clip.status === 'suspended' && <button disabled={busy || reason.trim().length < 3} onClick={() => moderate('restore')} className="rounded-lg px-4 py-2 text-white bg-emerald-700 font-bold disabled:opacity-40">Restore clip</button>}
        {['pending_review', 'published', 'suspended', 'rejected', 'failed'].includes(clip.status) && <button disabled={busy || reason.trim().length < 3} onClick={() => moderate('remove')} className="rounded-lg px-4 py-2 text-red-800 bg-red-100 font-bold disabled:opacity-40">Remove video</button>}
      </div>
      <div className="border-t pt-4 space-y-2" style={{ borderColor: 'var(--c-border)' }}><h3 className="font-bold text-sm">Creator controls</h3><p className="text-sm" style={{ color: 'var(--c-text-3)' }}>Restrict access to Clips and hide this creator’s videos. Their messaging account remains available.</p><button disabled={busy || reason.trim().length < 3} onClick={suspend} className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-40" style={{ borderColor: 'var(--c-border)' }}>{clip.publisherSuspended ? 'Restore Clips access' : 'Restrict from Clips'}</button></div>
    </section>
  </div>;
}
