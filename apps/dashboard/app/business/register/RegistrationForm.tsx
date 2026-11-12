'use client';

import { useRef, useState, type FormEvent } from 'react';
import {
  createUserWithEmailAndPassword,
  inMemoryPersistence,
  sendEmailVerification,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { ArrowRight, Building2, ClipboardCheck, MailCheck } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { BusinessBrand } from '../BusinessShell';
import layout from '../business.module.css';
import styles from './registration.module.css';

type Mode = 'apply' | 'status';
type RegistrationStatus = 'pending' | 'approving' | 'approved' | 'rejected';
type Registration = { status: RegistrationStatus; name: string; rejectionReason?: string };
type Verification = { user: User; name?: string; sent: boolean };

const applicationSteps = [
  { icon: Building2, title: 'Create your application', detail: 'Enter your organization name and a contact email you can verify.' },
  { icon: MailCheck, title: 'Verify your email', detail: 'Open the verification link and return here to submit your application.' },
  { icon: ClipboardCheck, title: 'Wait for approval', detail: 'OfflineSMS reviews each application before opening its workspace.' },
];

const statusCopy = {
  pending: ['Application pending', 'Your application has been received and is waiting for a decision.'],
  approved: ['Application approved', 'Sign in with the email and password you used to apply.'],
  rejected: ['Application declined', 'The OfflineSMS administrator declined this application.'],
} as const;

function authenticationError(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Check your email and password. If you already use this email with OfflineSMS, enter its existing password.';
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return 'Choose a stronger password and try again.';
    case 'auth/unauthorized-continue-uri':
      return 'Email verification is temporarily unavailable. Try again later.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait before trying again.';
    default:
      return 'Could not continue. Check your connection and try again.';
  }
}

async function authenticate(email: string, password: string, mode: Mode) {
  await setPersistence(auth, inMemoryPersistence);
  if (mode === 'apply') {
    try {
      return (await createUserWithEmailAndPassword(auth, email, password)).user;
    } catch (error) {
      if ((error as { code?: string } | null)?.code !== 'auth/email-already-in-use') throw error;
    }
  }
  return (await signInWithEmailAndPassword(auth, email, password)).user;
}

export default function RegistrationForm() {
  const passwordInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>('apply');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [verification, setVerification] = useState<Verification | null>(null);
  const [registration, setRegistration] = useState<Registration | null>(null);

  async function requestApplication(user: User, name?: string) {
    const idToken = await user.getIdToken(true);
    const response = await fetch('/api/business/registration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, name }),
    });
    const body = await response.json().catch(() => null);

    if (response.ok && body && typeof body.name === 'string' &&
      ['pending', 'approving', 'approved', 'rejected'].includes(body.status)) {
      setRegistration({
        status: body.status,
        name: body.name,
        rejectionReason: body.status === 'rejected' && typeof body.rejectionReason === 'string'
          ? body.rejectionReason.trim()
          : undefined,
      });
      setVerification(null);
      return;
    }
    if (body?.error === 'email_not_verified') {
      setVerification({ user, name, sent: false });
      setError('Verify your email before submitting or checking your application.');
      return;
    }
    setVerification(null);
    if (response.status === 404 && body?.error === 'registration_not_found') {
      setError('There is no application for this account. Use the application form to submit one.');
    } else if (body?.error === 'account_already_has_admin_access') {
      setError('This account already has administrator access. Sign in or use a different email to apply.');
    } else {
      setError('Could not access your application. Please try again.');
    }
  }

  async function sendVerification(current: Verification) {
    setVerification(current);
    try {
      await sendEmailVerification(current.user, { url: new URL('/register', window.location.origin).href });
      setVerification({ ...current, sent: true });
    } catch (error) {
      setError(authenticationError(error));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = passwordInput.current?.value ?? '';
    const name = mode === 'apply' ? String(form.get('name') ?? '').trim() : undefined;
    if (mode === 'apply' && !name) {
      setError('Enter your organization name.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const user = await authenticate(String(form.get('email')).trim(), password, mode);
      if (!user.emailVerified) {
        await sendVerification({ user, name, sent: false });
      } else {
        await requestApplication(user, name);
      }
    } catch (error) {
      setError(authenticationError(error));
    } finally {
      setBusy(false);
    }
  }

  async function verifyAndContinue() {
    if (!verification) return;
    setBusy(true);
    setError('');
    try {
      await verification.user.reload();
      if (verification.user.emailVerified) {
        await requestApplication(verification.user, verification.name);
      } else {
        setError('Your email is still unverified. Open the link we sent, then try again.');
      }
    } catch (error) {
      setError(authenticationError(error));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!verification) return;
    setBusy(true);
    setError('');
    try {
      await sendVerification(verification);
    } finally {
      setBusy(false);
    }
  }

  async function reset(nextMode: Mode) {
    setBusy(true);
    try { await signOut(auth); } catch { /* In-memory credentials end on navigation. */ }
    setMode(nextMode);
    setRegistration(null);
    setVerification(null);
    setError('');
    setBusy(false);
  }

  const resultStatus = registration?.status === 'approving' ? 'pending' : registration?.status;
  const result = resultStatus ? statusCopy[resultStatus] : null;
  return (
    <main id="main-content" className={`${layout.portal} ${layout.login}`}>
      <div className={layout.loginGrid}>
        <section className={layout.loginMain}>
          <BusinessBrand />
          <div className={layout.loginFormPanel}>
            <h1 aria-live="polite">{result?.[0] ?? (verification ? 'Verify your email' : mode === 'apply' ? 'Apply as an organization' : 'Check application status')}</h1>
            <p>{result?.[1] ?? (verification
              ? 'Open the verification link in your email, then return to this tab to continue.'
              : mode === 'apply'
                ? 'Apply for an OfflineSMS Business workspace.'
                : 'Sign in with the account you used for your application.')}</p>

            {result && registration ? (
              <div className={styles.result} role="status">
                <Building2 size={19} aria-hidden />
                <div>
                  <strong>{registration.name}</strong>
                  {registration.rejectionReason && <p className={styles.reason}>{registration.rejectionReason}</p>}
                </div>
              </div>
            ) : verification ? (
              <div className={layout.loginForm}>
                {verification.sent && <p className={styles.notice} role="status">Verification email sent to <strong>{verification.user.email}</strong>.</p>}
                {error && <p className={layout.error} role="alert">{error}</p>}
                <button type="button" className={layout.primary} onClick={verifyAndContinue} disabled={busy}>
                  I verified my email <ArrowRight size={18} aria-hidden />
                </button>
                <button type="button" className={styles.secondary} onClick={resend} disabled={busy}>
                  Resend verification email
                </button>
                <button type="button" className={styles.textLink} onClick={() => reset(mode)} disabled={busy}>
                  Change email address
                </button>
              </div>
            ) : (
              <form key={mode} className={layout.loginForm} method="post" onSubmit={submit}>
                {mode === 'apply' && (
                  <label>
                    Organization name
                    <input name="name" autoComplete="organization" maxLength={120} required />
                  </label>
                )}
                <label>
                  Email address
                  <input type="email" name="email" autoComplete="username" maxLength={254} required />
                </label>
                <label>
                  Password
                  <input type="password" ref={passwordInput} autoComplete={mode === 'apply' ? 'new-password' : 'current-password'} required />
                </label>
                {error && <p className={layout.error} role="alert">{error}</p>}
                <button type="submit" className={layout.primary} disabled={busy}>
                  {busy ? 'Please wait…' : mode === 'apply' ? 'Continue with email' : 'Check status'}
                  <ArrowRight size={18} aria-hidden />
                </button>
              </form>
            )}

            <div className={styles.links}>
              {!verification && resultStatus !== 'approved' && (
                <button type="button" className={styles.textLink}
                  onClick={() => reset(registration || mode === 'apply' ? 'status' : 'apply')} disabled={busy}>
                  {registration || mode === 'apply' ? 'Check application status' : 'Apply as an organization'}
                </button>
              )}
              <a className={styles.textLink} href="/login">{resultStatus === 'approved' ? 'Sign in to Business' : 'Back to sign-in'}</a>
            </div>
          </div>
        </section>
        <section className={layout.loginAside} aria-labelledby="registration-steps">
          <h2 id="registration-steps">Start your Business workspace</h2>
          <ul className={layout.steps}>
            {applicationSteps.map(({ icon: Icon, title, detail }) => (
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
