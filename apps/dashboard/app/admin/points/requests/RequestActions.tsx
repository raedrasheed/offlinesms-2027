'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reviewPointsRequestAction } from '@/lib/pointsRequestActions';

export default function RequestActions({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function run(outcome: 'approved' | 'rejected') {
    setErr(null);
    start(async () => {
      const res = await reviewPointsRequestAction(requestId, outcome);
      if (res.error) setErr(res.error); else router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        onClick={() => run('rejected')}
        disabled={pending}
        className="px-2.5 py-1 text-[11px] font-bold rounded-md transition hover:brightness-110 disabled:opacity-50"
        style={{ background: 'transparent', color: '#EF4444', border: '1px solid #7F1D1D' }}
      >
        Reject
      </button>
      <button
        onClick={() => run('approved')}
        disabled={pending}
        className="px-2.5 py-1 text-[11px] font-bold rounded-md transition hover:brightness-110 disabled:opacity-50"
        style={{ background: '#0A1828', color: '#22C55E', border: '1px solid #14532D' }}
      >
        {pending ? '…' : 'Approve'}
      </button>
      {err && <span className="text-[10px]" style={{ color: '#EF4444' }}>{err}</span>}
    </div>
  );
}
