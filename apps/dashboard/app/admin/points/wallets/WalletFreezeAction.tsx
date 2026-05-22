'use client';
import { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

type Props = { uid: string; currentStatus: string };

export default function WalletFreezeAction({ uid, currentStatus }: Props) {
  const isFrozen = currentStatus === 'frozen';
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function handleClick() {
    const newStatus = isFrozen ? 'active' : 'frozen';
    const msg = isFrozen
      ? 'Unfreeze this wallet? Transfers and SMS spending will resume.'
      : 'Freeze this wallet? This prevents all transfers and SMS spending until unfrozen.';
    if (!confirm(msg)) return;
    setBusy(true);
    setErr(null);
    try {
      const fns = getFunctions(app, 'us-central1');
      await httpsCallable(fns, 'adminSetWalletStatus')({ walletOwnerUid: uid, status: newStatus });
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleClick}
        disabled={busy}
        className={`px-3 py-1 text-xs font-bold rounded-lg transition disabled:opacity-50 ${
          isFrozen
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
            : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
        }`}
      >
        {busy ? '…' : isFrozen ? 'Unfreeze' : 'Freeze'}
      </button>
      {err && <span className="text-[10px] text-red-600">{err}</span>}
    </div>
  );
}
