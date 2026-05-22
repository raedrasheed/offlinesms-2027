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
  const btnClass = isSuspended
    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
    : 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200';

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
        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${btnClass} disabled:opacity-50`}
      >
        {busy ? 'Working…' : label}
      </button>
      {err && <p className="text-[10px] text-red-600">{err}</p>}
    </div>
  );
}
