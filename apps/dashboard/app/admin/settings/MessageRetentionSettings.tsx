'use client';
import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { previewMessageRetention, updateMessageRetention } from '@/lib/messageRetentionActions';

function Save() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="rounded-lg px-4 py-2 bg-sky-700 text-white disabled:opacity-50">{pending ? 'Saving…' : 'Save retention policy'}</button>;
}
export default function MessageRetentionSettings({ days: initialDays, enabled: initialEnabled, lastRun }: {
  days: number; enabled: boolean; lastRun?: { at: string; deleted: number; failed: number } | null;
}) {
  const [state, action] = useFormState(updateMessageRetention, null);
  const [days, setDays] = useState(String(initialDays));
  const [enabled, setEnabled] = useState(initialEnabled);
  const [preview, setPreview] = useState<{ days: string; count: number; lowerBound?: boolean } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  async function check() {
    const requested = days;
    setChecking(true); setError(''); setConfirmed(false); setPreview(null);
    try {
      const result = await previewMessageRetention(Number(requested));
      if (result.error) setError(result.error);
      else setPreview({ days: requested, count: result.count ?? 0, lowerBound: result.lowerBound });
    } catch { setError('Could not preview deletion. Please try again.'); }
    finally { setChecking(false); }
  }
  return (
    <form action={action} className="rounded-2xl p-6 space-y-4" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>
      <h2 className="font-extrabold text-sm">Message retention · الاحتفاظ بالرسائل</h2>
      <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>Delete cloud chat messages and their attachments after this many days from sending. Downloaded phone history remains. Older messages cannot be recovered from Firebase on a new device.</p>
      <label className="block text-sm" htmlFor="retention-days">Retention days / عدد الأيام</label>
      <input id="retention-days" name="messageRetentionDays" type="number" min={1} max={3650} step={1} required value={days}
        onChange={e => { setDays(e.target.value); setPreview(null); setConfirmed(false); }}
        className="rounded-lg p-2 w-32" style={{ background: 'var(--c-bg)', border: '1px solid var(--c-border)' }} />
      <label className="flex gap-2 text-sm"><input type="checkbox" name="messageRetentionEnabled" value="true" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Enable automatic cloud deletion</label>
      <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>Applies to existing and new messages. Runs every 15 minutes in bounded batches; a backlog may take longer. Increasing the duration cannot restore deleted messages. Pausing stops new deletions; cleanup already started will finish on the next enabled run.</p>
      <button type="button" disabled={checking} onClick={() => void check()} className="rounded-lg border px-3 py-2 text-sm">{checking ? 'Checking…' : 'Preview affected messages'}</button>
      {preview?.days === days && <div className="text-sm space-y-2">
        <p>{preview.lowerBound ? 'At least ' : ''}{preview.count.toLocaleString()} messages currently meet this policy.</p>
        <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I confirm permanent cloud deletion under this policy.</label>
      </div>}
      <input type="hidden" name="confirmedDays" value={confirmed && preview?.days === days ? days : ''} />
      {(error || state?.error) && <p role="alert" className="text-sm text-red-500">{error || state?.error}</p>}
      {state?.success && <p role="status" className="text-sm text-emerald-500">Retention policy saved.</p>}
      {lastRun && <p className="text-xs">Last cleanup: {lastRun.at} · deleted {lastRun.deleted} · failed {lastRun.failed}</p>}
      <div><Save /></div>
    </form>
  );
}
