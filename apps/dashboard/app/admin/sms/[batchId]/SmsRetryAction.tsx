'use client';

import { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '@/lib/firebase';

type RetryResult = {
  batchId: string;
  sent: number;
  failed: number;
  status: string;
};

type Props = { batchId: string; failedCount: number };

export default function SmsRetryAction({ batchId, failedCount }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<RetryResult | null>(null);

  async function handleRetry() {
    if (!confirm(
      `Retry failed recipients only. This may reserve OfflineSMS Points from the batch sender's wallet. Continue?`
    )) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const fns = getFunctions(app, 'us-central1');
      const res = await httpsCallable<{ batchId: string }, RetryResult>(
        fns, 'retryFailedSmsRecipients'
      )({ batchId });
      setResult(res.data);
    } catch (e: any) {
      setErr(e?.message ?? 'Retry failed.');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="rounded-xl p-4" style={{ background: '#052E1B', border: '1px solid #0A4428' }}>
        <p className="text-sm font-bold" style={{ color: '#22C55E' }}>Retry submitted</p>
        <p className="text-xs mt-1" style={{ color: '#22C55E' }}>
          New batch: <span className="font-mono">{result.batchId.slice(0, 16)}…</span>
          {' · '}Queued: {result.sent}
          {result.failed > 0 && <span style={{ color: '#EF4444' }}> · Failed at gateway: {result.failed}</span>}
          {' · '}Status: {result.status}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: '#131B27', border: '1px solid #1A2437' }}>
      <div>
        <p className="text-sm font-bold" style={{ color: '#E2E8F2' }}>{failedCount} failed recipient{failedCount !== 1 ? 's' : ''}</p>
        <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>
          Retrying will create a new batch for failed recipients only. No SMS body or phone numbers are shown here.
        </p>
      </div>
      <div className="flex items-center gap-3">
        {err && <p className="text-xs max-w-[200px]" style={{ color: '#EF4444' }}>{err}</p>}
        <button
          onClick={handleRetry}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-bold rounded-lg transition hover:brightness-110 disabled:opacity-50"
          style={{ background: '#1C1405', color: '#F59E0B', border: '1px solid #2A2005' }}
        >
          {busy ? 'Retrying…' : 'Retry failed'}
        </button>
      </div>
    </div>
  );
}
