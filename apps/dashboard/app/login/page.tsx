'use client';

import { Suspense, useState } from 'react';
import Image from 'next/image';
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useRouter, useSearchParams } from 'next/navigation';

// The login page initialises the Firebase client SDK, which is unsafe to
// prerender without a complete set of NEXT_PUBLIC_FIREBASE_* env vars.
// Force dynamic rendering so `next build` doesn't try to prerender it in
// environments (CI, fresh clones) where those vars are absent.
export const dynamic = 'force-dynamic';

async function exchangeForSession(idToken: string) {
  const res = await fetch('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `session_exchange_failed_${res.status}`);
  }
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/admin';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await cred.user.getIdToken();
      await exchangeForSession(idToken);
      router.push(next as any);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function google() {
    setBusy(true); setErr(null);
    try {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      const idToken = await cred.user.getIdToken();
      await exchangeForSession(idToken);
      router.push(next as any);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={signIn} className="bg-white rounded-2xl shadow-sh3 p-8 w-[380px]">
      <div className="flex flex-col items-center gap-2 mb-6">
        <Image src="/logo.png" alt="OfflineSMS" width={72} height={72} className="rounded-2xl" />
        <span className="font-extrabold text-xl tracking-tight">Offline<span className="text-primary">SMS</span></span>
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight text-center">Sign in</h1>
      <p className="text-sm text-ink-500 mt-1 text-center">Admin dashboard access.</p>
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
  );
}

export default function Login() {
  return (
    <div className="min-h-screen grid place-items-center bg-canvas">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
