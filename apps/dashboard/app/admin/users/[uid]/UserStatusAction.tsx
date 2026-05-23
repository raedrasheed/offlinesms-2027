'use client';
import { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

type Props = { uid: string; currentStatus: string };

export default function UserStatusAction({ uid, currentStatus }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const isSuspended = currentStatus === 'suspended';
  const label = isSuspended ? 'Reactivate user' : 'Suspend user';
  const nextStatus = isSuspended ? 'active' : 'suspended';
  const btnStyle = isSuspended
    ? { background: 'var(--c-success-bg)', color: '#22C55E', border: '1px solid var(--c-success-border)' }
    : { background: 'var(--c-error-bg)', color: '#EF4444', border: '1px solid var(--c-error-border)' };

  async function handleClick() {
    if (!confirm(`${label}? This action is logged.`)) return;
    setBusy(true);
    setErr(null);
    try {
      const fns = getFunctions(app, 'us-central1');
      const fn = httpsCallable(fns, 'setUserStatus');
      await fn({ uid, status: nextStatus });
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={busy}
        className="px-3 py-1.5 rounded-lg text-xs font-bold transition hover:brightness-110 disabled:opacity-50"
        style={btnStyle}
      >
        {busy ? 'Working…' : label}
      </button>
      {err && <p className="text-[10px]" style={{ color: '#EF4444' }}>{err}</p>}
    </div>
  );
}
