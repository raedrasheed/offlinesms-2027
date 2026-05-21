'use client';
import { useState } from 'react';
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push('/admin');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function google() {
    setBusy(true); setErr(null);
    try { await signInWithPopup(auth, new GoogleAuthProvider()); router.push('/admin'); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-canvas">
      <form onSubmit={signIn} className="bg-white rounded-2xl shadow-sh3 p-8 w-[380px]">
        <div className="flex items-center gap-3 mb-6">
          <span className="brand-mark"/>
          <span className="font-extrabold text-xl tracking-tight">Offline<span className="text-primary">SMS</span></span>
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight">Sign in</h1>
        <p className="text-sm text-ink-500 mt-1">Admin dashboard access.</p>
        <input className="mt-5 w-full px-3 py-2.5 rounded-lg border border-ink-200 focus:border-primary outline-none text-sm" placeholder="Email"
          type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        <input className="mt-2 w-full px-3 py-2.5 rounded-lg border border-ink-200 focus:border-primary outline-none text-sm" placeholder="Password"
          type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
        <button className="mt-4 w-full py-2.5 rounded-lg bg-primary text-white font-bold text-sm disabled:opacity-50" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" onClick={google} className="mt-2 w-full py-2.5 rounded-lg border border-ink-200 font-semibold text-sm text-ink-700">
          Continue with Google
        </button>
      </form>
    </div>
  );
}
