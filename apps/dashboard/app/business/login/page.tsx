'use client';

import { useState, type FormEvent } from 'react';
import { inMemoryPersistence, setPersistence, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { ArrowRight, FileSpreadsheet, FolderOpen, Send } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { BusinessBrand } from '../BusinessShell';
import styles from '../business.module.css';

const steps = [
  { icon: FileSpreadsheet, title: 'Import recipients', detail: 'Review names and phone numbers from an Excel file.' },
  { icon: FolderOpen, title: 'Organize groups', detail: 'Keep recipient lists ready for future messages.' },
  { icon: Send, title: 'Send when ready', detail: 'Choose a saved group from the portal or your API integration.' },
];

export default function BusinessLogin() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await setPersistence(auth, inMemoryPersistence);
      const credential = await signInWithEmailAndPassword(auth, String(form.get('email')).trim(), String(form.get('password')));
      const idToken = await credential.user.getIdToken();
      const response = await fetch('/api/business/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      if (response.status === 403) {
        setError('Use the administrator account assigned to your organization.');
      } else if (!response.ok) {
        setError('Could not start your session. Please try again.');
      } else {
        window.location.replace('/');
        return;
      }
    } catch (err) {
      const code = (err as { code?: string })?.code;
      setError(
        code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password'
          ? 'Check your email and password and try again.'
          : 'Could not sign in. Please try again.',
      );
    } finally {
      try { await signOut(auth); } catch { /* Business sessions use the server cookie. */ }
      setBusy(false);
    }
  }

  return (
    <main id="main-content" className={`${styles.portal} ${styles.login}`}>
      <div className={styles.loginGrid}>
        <section className={styles.loginMain}>
          <BusinessBrand />
          <div className={styles.loginFormPanel}>
            <h1>Organization sign-in</h1>
            <p>Use your organization administrator account.</p>
            <form className={styles.loginForm} onSubmit={signIn}>
              <label>
                Email address
                <input type="email" name="email" autoComplete="username" required />
              </label>
              <label>
                Password
                <input type="password" name="password" autoComplete="current-password" required />
              </label>
              {error && <p className={styles.error} role="alert">{error}</p>}
              <button type="submit" className={styles.primary} disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
                <ArrowRight size={18} aria-hidden />
              </button>
            </form>
          </div>
        </section>
        <section className={styles.loginAside} aria-labelledby="login-aside-title">
          <h2 id="login-aside-title">Manage your organization’s messaging</h2>
          <ul className={styles.steps}>
            {steps.map(({ icon: Icon, title, detail }) => (
              <li key={title}>
                <span><Icon size={21} aria-hidden /></span>
                <div><h3>{title}</h3><p>{detail}</p></div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
