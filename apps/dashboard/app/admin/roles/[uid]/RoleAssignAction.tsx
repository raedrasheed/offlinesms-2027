'use client';
import { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { ADMIN_ROLE_OPTIONS } from './roleOptions';

type Props = { targetUid: string; currentRole: string | null };

export default function RoleAssignAction({ targetUid, currentRole }: Props) {
  const [selected, setSelected] = useState(currentRole ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm(`Assign role "${selected || 'none'}" to this user? This action is logged.`)) return;
    setBusy(true); setErr(null); setSuccess(false);
    try {
      const fns = getFunctions(app, 'us-central1');
      await httpsCallable(fns, 'adminSetRole')({ uid: targetUid, role: selected || null });
      setSuccess(true);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'Role assignment failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-3">
      <select
        value={selected}
        onChange={e => setSelected(e.target.value)}
        className="border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white"
        disabled={busy}
      >
        <option value="">— No role —</option>
        {ADMIN_ROLE_OPTIONS.map(r => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>
      <button
        type="submit"
        disabled={busy || selected === (currentRole ?? '')}
        className="px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary-dark transition disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Assign role'}
      </button>
      {err && <p className="text-xs text-red-600">{err}</p>}
      {success && <p className="text-xs text-emerald-600">Role updated.</p>}
    </form>
  );
}
