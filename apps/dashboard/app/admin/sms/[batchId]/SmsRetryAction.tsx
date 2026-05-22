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
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-bold text-emerald-800">Retry submitted</p>
        <p className="text-xs text-emerald-700 mt-1">
          New batch: <span className="font-mono">{result.batchId.slice(0, 16)}…</span>
          {' · '}Queued: {result.sent}
          {result.failed > 0 && <span className="text-red-600"> · Failed at gateway: {result.failed}</span>}
          {' · '}Status: {result.status}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-ink-100 bg-surface3/50 p-4 flex items-center justify-between">
      <div>
        <p className="text-sm font-bold text-ink-900">{failedCount} failed recipient{failedCount !== 1 ? 's' : ''}</p>
        <p className="text-xs text-ink-500">
          Retrying will create a new batch for failed recipients only. No SMS body or phone numbers are shown here.
        </p>
      </div>
      <div className="flex items-center gap-3">
        {err && <p className="text-xs text-red-600 max-w-[200px]">{err}</p>}
        <button
          onClick={handleRetry}
          disabled={busy}
          className="px-3 py-1.5 bg-amber-600 text-white text-xs font-bold rounded-lg hover:bg-amber-700 transition disabled:opacity-50"
        >
          {busy ? 'Retrying…' : 'Retry failed'}
        </button>
      </div>
    </div>
  );
}
