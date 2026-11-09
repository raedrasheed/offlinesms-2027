'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAdminStatusPreview, moderateStatus } from '@/lib/statusAdminActions';

type Props = { id: string; type: 'text' | 'image' | 'video'; expired: boolean; suspended: boolean; version: string };

export default function StatusReview({ id, type, expired, suspended, version }: Props) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [url, setUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  async function preview() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await getAdminStatusPreview(id);
      if (result.url) setUrl(result.url);
      else setError(result.error);
    } catch {
      setError('Could not load the preview. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await moderateStatus({ id, suspended: !suspended, reason, version });
      if (result.error) setError(result.error);
      else {
        setMessage(suspended ? 'Status restored.' : 'Status suspended.');
        setReason('');
        router.refresh();
      }
    } catch {
      setError('Could not save the decision. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-4">
    {type !== 'text' && <div className="space-y-3">
      {url && (type === 'video'
        ? <video key={url} src={url} controls controlsList="nodownload" playsInline preload="metadata" className="w-full max-h-96 rounded-lg" onError={() => setError('Preview unavailable. Load a fresh preview.')}><track kind="captions" /></video>
        // Signed media is fetched directly to keep its URL out of the image optimizer cache.
        // eslint-disable-next-line @next/next/no-img-element
        : <img key={url} src={url} alt="Status preview" className="max-w-full max-h-96 rounded-lg" onError={() => setError('Preview unavailable. Load a fresh preview.')} />)}
      <button type="button" disabled={busy} onClick={preview} className="rounded-lg px-4 py-2 text-white bg-sky-700 text-sm font-semibold disabled:opacity-40">{url ? 'Refresh preview' : 'Load media preview'}</button>
      <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>Preview access is logged and expires after two minutes.</p>
    </div>}
    {error && <p role="alert" className="rounded-lg p-3 text-red-800 bg-red-50">{error}</p>}
    {message && <p role="status" className="rounded-lg p-3 text-green-800 bg-green-50">{message}</p>}
    {expired ? <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>This status has expired.</p>
      : <form className="space-y-3" onSubmit={submit}>
        <label className="block text-sm font-semibold">Decision reason
          <textarea value={reason} onChange={e => setReason(e.target.value)} required minLength={3} maxLength={500} rows={3} className="block w-full mt-1 rounded-lg border p-3" style={{ background: 'var(--c-bg)', borderColor: 'var(--c-border)' }} />
        </label>
        <button disabled={busy || reason.trim().length < 3} className={`rounded-lg px-4 py-2 text-white font-semibold disabled:opacity-40 ${suspended ? 'bg-emerald-700' : 'bg-red-700'}`}>
          {suspended ? 'Restore status' : 'Suspend status'}
        </button>
      </form>}
  </div>;
}
