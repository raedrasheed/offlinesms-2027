'use client';
import { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { Lock, Unlock } from 'lucide-react';

type Props = { conversationId: string; locked: boolean };

export default function GroupLockAction({ conversationId, locked }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const label = locked ? 'Unlock group' : 'Lock group';
  const Icon = locked ? Unlock : Lock;

  async function handleClick() {
    if (!confirm(`${label}? This action is logged.`)) return;
    setBusy(true);
    setErr(null);
    try {
      const fns = getFunctions(app, 'us-central1');
      const fn = httpsCallable(fns, 'adminLockGroup');
      await fn({ conversationId, locked: !locked });
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
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 transition disabled:opacity-50"
      >
        <Icon size={12} />
        {busy ? 'Working…' : label}
      </button>
      {err && <p className="text-[10px] text-red-600 max-w-[200px] text-right">{err}</p>}
    </div>
  );
}
