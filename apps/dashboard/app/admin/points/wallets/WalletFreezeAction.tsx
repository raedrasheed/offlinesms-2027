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

  const btnStyle = isFrozen
    ? { background: '#052E1B', color: '#22C55E', border: '1px solid #0A4428' }
    : { background: '#1C1405', color: '#F59E0B', border: '1px solid #2A2005' };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleClick}
        disabled={busy}
        className="px-3 py-1 text-xs font-bold rounded-lg transition hover:brightness-110 disabled:opacity-50"
        style={btnStyle}
      >
        {busy ? '…' : isFrozen ? 'Unfreeze' : 'Freeze'}
      </button>
      {err && <span className="text-[10px]" style={{ color: '#EF4444' }}>{err}</span>}
    </div>
  );
}
