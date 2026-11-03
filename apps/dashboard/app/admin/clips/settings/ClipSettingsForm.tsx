'use client';
import { useEffect, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { saveClipSettings } from '@/lib/clipAdminActions';
import type { ClipAdminConfig } from '@/lib/clipAdminPolicy';
const input = { color: 'var(--c-text)', background: 'var(--c-bg)', border: '1px solid var(--c-border)' };
function Save() { const { pending } = useFormStatus(); return <button disabled={pending} className="rounded-lg px-5 py-2 text-white font-bold disabled:opacity-50" style={{ background: '#1F7BA8' }}>{pending ? 'Saving…' : 'Save Clips settings'}</button>; }
export default function ClipSettingsForm({ config, version }: { config: ClipAdminConfig; version: string }) {
  const [state, action] = useFormState(saveClipSettings, null);
  const [enabled, setEnabled] = useState(config.enabled);
  const [review, setReview] = useState(config.moderationRequired);
  const router = useRouter();
  useEffect(() => { if (state?.success) router.refresh(); }, [state, router]);
  return <form action={action} className="max-w-3xl rounded-2xl border p-6 space-y-5" style={{ background: 'var(--c-card)', borderColor: 'var(--c-border)' }}>
    <h2 className="text-lg font-bold">Publishing settings</h2>
    <input type="hidden" name="version" value={version} />
    {state?.error && <p role="alert" className="rounded-lg p-3 text-red-700 bg-red-50">{state.error}</p>}
    {state?.success && <p role="status" className="rounded-lg p-3 text-green-700 bg-green-50">Settings saved.</p>}
    <input type="hidden" name="enabled" value={String(enabled)} />
    <label className="flex gap-3 items-start"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="mt-1" /><span><strong>Enable Clips and posts</strong><span className="block text-sm mt-1" style={{ color: 'var(--c-text-3)' }}>Allow users to browse and publish clips and posts. Moderation remains available while the feature is disabled.</span></span></label>
    <input type="hidden" name="moderationRequired" value={String(review)} />
    <label className="flex gap-3 items-start"><input type="checkbox" checked={review} onChange={e => setReview(e.target.checked)} className="mt-1" /><span><strong>Review before publication</strong><span className="block text-sm mt-1" style={{ color: 'var(--c-text-3)' }}>New videos, posts and content changes wait for administrator approval. Turning this off allows processed submissions to publish automatically.</span></span></label>
    <div className="grid sm:grid-cols-3 gap-4">{[
      ['maxDurationSeconds', 'Maximum duration (seconds)', config.maxDurationSeconds, 1, 180],
      ['maxUploadMB', 'Maximum upload (MB)', config.maxUploadMB, 1, 200],
      ['maxDailyUploads', 'Daily uploads per user', config.maxDailyUploads, 1, 100],
    ].map(([name, label, value, min, max]) => <label key={String(name)} className="text-sm font-semibold">{label}<input name={String(name)} type="number" min={Number(min)} max={Number(max)} step="1" required defaultValue={value} className="w-full rounded-lg p-2 mt-1" style={input} /></label>)}</div>
    <label className="block text-sm font-semibold">Community terms version<input name="termsVersion" required maxLength={50} defaultValue={config.termsVersion} className="w-full rounded-lg p-2 mt-1" style={input} /><span className="block text-xs font-normal mt-1" style={{ color: 'var(--c-text-3)' }}>Changing the version requires users to accept the current publishing terms again.</span></label>
    <label className="block text-sm font-semibold">Support and appeals email<input name="supportEmail" type="email" maxLength={120} required={enabled} defaultValue={config.supportEmail} className="w-full rounded-lg p-2 mt-1" style={input} /><span className="block text-xs font-normal mt-1" style={{ color: 'var(--c-text-3)' }}>Shown to users. Initially inherits the general support email when available.</span></label>
    <div className="flex items-center gap-3"><Save /><span className="text-xs" style={{ color: 'var(--c-text-3)' }}>Changes are audited.</span></div>
  </form>;
}
