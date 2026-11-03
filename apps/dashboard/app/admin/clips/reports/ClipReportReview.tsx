'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminClipReport } from '@/lib/clipAdminData';
import { resolveClipReport } from '@/lib/clipAdminActions';
type DecisionAction = 'none' | 'remove_clip' | 'remove_comment' | 'suspend_publisher';
export default function ClipReportReview({ report }: { report: AdminClipReport }) {
  const [action, setAction] = useState<DecisionAction>('none');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function resolve(decision: 'resolved' | 'dismissed') {
    setBusy(true); setError(null);
    try {
      const result = await resolveClipReport({ reportId: report.id, version: report.version, decision,
        action: decision === 'dismissed' ? 'none' : action, reason });
      if (result?.error) setError(result.error); else router.refresh();
    } catch { setError('Could not save this report decision. Try again.'); } finally { setBusy(false); }
  }
  return <article className="rounded-xl border p-5 space-y-4" style={{ background: 'var(--c-card)', borderColor: 'var(--c-border)' }}>
    <div className="flex flex-wrap justify-between gap-2"><div><span className="font-bold capitalize">{report.reason}</span><span className="ml-2 text-xs capitalize" style={{ color: 'var(--c-text-3)' }}>{report.status} · {report.commentId ? 'Comment report' : 'Video report'}</span></div><Link href={`/admin/clips/${report.clipId}` as any} className="text-sm font-bold" style={{ color: '#1F7BA8' }}>Review video →</Link></div>
    <p className="text-sm whitespace-pre-wrap break-words" dir="auto">{report.details || 'No additional details.'}</p>
    <p className="text-xs break-all" style={{ color: 'var(--c-text-3)' }}>Reporter: {report.reporterUid} · Creator: {report.ownerUid}{report.commentId ? ` · Comment: ${report.commentId}` : ''}</p>
    {report.commentId && <blockquote className="rounded-lg border-l-4 border-sky-300 p-3 text-sm" style={{ background: 'var(--c-bg)' }}><p className="font-semibold mb-1">Reported comment{report.commentAuthorUid ? ` · ${report.commentAuthorUid}` : ''}</p><p className="whitespace-pre-wrap break-words" dir="auto">{report.commentDeleted ? 'This comment has already been removed.' : report.commentText}</p></blockquote>}
    {report.resolution && <p className="text-sm rounded-lg p-3" style={{ background: 'var(--c-bg)' }}>{report.resolution}</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {report.status === 'open' && <div className="space-y-3 border-t pt-4" style={{ borderColor: 'var(--c-border)' }}>
      <label className="block text-sm font-semibold">Action<select value={action} onChange={e => setAction(e.target.value as DecisionAction)} className="block rounded-lg border mt-1 p-2 w-full sm:w-80" style={{ background: 'var(--c-bg)', borderColor: 'var(--c-border)' }}><option value="none">Resolve without another action</option><option value="remove_clip">Remove the video</option>{report.commentId && <option value="remove_comment">Remove the reported comment</option>}<option value="suspend_publisher">Restrict the creator from Clips and hide their videos</option></select></label>
      <label className="block text-sm font-semibold">Resolution note<textarea rows={2} minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} className="block w-full rounded-lg border p-2 mt-1" style={{ background: 'var(--c-bg)', borderColor: 'var(--c-border)' }} /></label>
      <div className="flex gap-2"><button disabled={busy || reason.trim().length < 3} onClick={() => resolve('resolved')} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-40" style={{ background: '#1F7BA8' }}>{busy ? 'Saving…' : 'Resolve report'}</button><button disabled={busy || reason.trim().length < 3} onClick={() => resolve('dismissed')} className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-40" style={{ borderColor: 'var(--c-border)' }}>Dismiss report</button></div>
    </div>}
  </article>;
}
