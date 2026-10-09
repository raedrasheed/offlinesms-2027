// Sign-in methods of the signed-in account (Settings → Email / Phone number).
// Thin client over the authenticated callables — every rule (eligibility,
// re-authentication, limits, uniqueness, code checks) is enforced on the
// server. Adding or changing a method never switches accounts: every token this
// module signs in with is checked to belong to the CURRENT uid first.

import { getFunctions, httpsCallable } from 'firebase/functions';
import { signInWithCustomToken } from 'firebase/auth';
import * as Crypto from 'expo-crypto';
import { app, auth } from './firebase';
import { newPhoneAuthFlow } from './phoneAuth';
import type { PhoneAuthFlow } from './phoneAuth.flow';

const fns = () => getFunctions(app, 'us-central1');

export interface SignInMethods {
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  emailChange: { available: boolean; pendingRecovery: boolean; pendingChallengeId: string | null; reauthRequired: boolean; codeTtlSec: number };
}

export async function getSignInMethods(): Promise<SignInMethods> {
  return (await httpsCallable<Record<string, never>, SignInMethods>(fns(), 'getSignInMethods')({})).data;
}

export interface EmailChallenge { challengeId: string; expiresAtMs: number; resendAfterSec: number; maskedEmail: string }

export async function requestEmailChangeCode(email: string): Promise<EmailChallenge> {
  return (await httpsCallable<{ email: string }, EmailChallenge & { ok: boolean }>(fns(), 'requestEmailChangeCode')({ email: email.trim() })).data;
}

interface ChangeResult { changed: true; email: string; maskedEmail: string; customToken: string }

/** Firebase ends existing sessions when the email changes; continue on this
 *  device with the server's token — only if it is for the same account. */
async function continueSession(r: ChangeResult): Promise<ChangeResult> {
  const me = auth.currentUser?.uid;
  if (r.customToken && me) {
    await signInWithCustomToken(auth, r.customToken);
    if (auth.currentUser?.uid !== me) throw new Error('account-mismatch');
    await auth.currentUser?.reload().catch(() => {});
  }
  return r;
}

// The email change signs out every session, this one included. If the reply
// carrying the replacement token is lost, this device finishes the change with
// a one-off recovery key it sent along with the code — kept in memory only and
// bound by the server to this challenge.
const recoveryKeys = new Map<string, string>();

async function recoveryKeyFor(challengeId: string): Promise<string> {
  let k = recoveryKeys.get(challengeId);
  if (!k) {
    const b = await Crypto.getRandomBytesAsync(32);
    k = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    recoveryKeys.set(challengeId, k);
  }
  return k;
}

export async function verifyEmailChangeCode(challengeId: string, code: string): Promise<ChangeResult> {
  const recoveryKey = await recoveryKeyFor(challengeId);
  const res = await httpsCallable<{ challengeId: string; code: string; recoveryKey: string }, ChangeResult>(fns(), 'verifyEmailChangeCode')({ challengeId, code, recoveryKey });
  const out = await continueSession(res.data);
  recoveryKeys.delete(challengeId);
  return out;
}

export async function resumeEmailChange(challengeId: string): Promise<ChangeResult> {
  const recoveryKey = recoveryKeys.get(challengeId);
  const res = await httpsCallable<{ challengeId: string; recoveryKey?: string }, ChangeResult>(fns(), 'resumeEmailChange')(
    recoveryKey ? { challengeId, recoveryKey } : { challengeId });
  const out = await continueSession(res.data);
  recoveryKeys.delete(challengeId);
  return out;
}

// ── Re-authentication with a method the account ALREADY has ─────────────────

export type ReauthMethod = 'email' | 'phone';

/** Methods this account can confirm itself with right now. */
export function reauthMethods(): ReauthMethod[] {
  const u = auth.currentUser;
  const out: ReauthMethod[] = [];
  if (u?.email) out.push('email');
  if (u?.phoneNumber) out.push('phone');
  return out;
}

/** Send a code to the account's own email. */
export async function sendReauthEmailCode(): Promise<void> {
  const email = auth.currentUser?.email;
  if (!email) throw new Error('reauth-required');
  await httpsCallable<{ email: string }, { ok: boolean }>(fns(), 'requestEmailOtp')({ email });
}

/** Confirm with the emailed code; refuses (without signing in) if the code
 *  belongs to any account other than the current one. */
export async function reauthenticateWithEmailCode(code: string): Promise<void> {
  const me = auth.currentUser;
  if (!me?.email) throw new Error('reauth-required');
  const res = await httpsCallable<{ email: string; code: string }, { customToken: string; uid: string }>(
    fns(), 'verifyEmailOtp',
  )({ email: me.email, code });
  if (res.data?.uid !== me.uid) throw new Error('reauth-required');
  await signInWithCustomToken(auth, res.data.customToken);
  await auth.currentUser?.getIdToken(true);
}

let phoneReauth: { flow: PhoneAuthFlow; challengeId: string } | null = null;

/** Send a sign-in code by SMS to the account's own number. */
export async function sendReauthPhoneCode(): Promise<{ maskedPhone: string; resendAfterSec: number }> {
  const phone = auth.currentUser?.phoneNumber;
  if (!phone) throw new Error('reauth-required');
  const flow = await newPhoneAuthFlow();
  const r = await flow.sendCode(phone);
  phoneReauth = { flow, challengeId: r.challengeId };
  return { maskedPhone: r.maskedPhone, resendAfterSec: r.resendAfterSec };
}

/** Confirm with the SMS code; refuses (without signing in) unless it resolves
 *  to the current account. */
export async function reauthenticateWithPhoneCode(code: string): Promise<void> {
  const me = auth.currentUser;
  if (!me || !phoneReauth) throw new Error('reauth-required');
  const res = await phoneReauth.flow.verify(phoneReauth.challengeId, code);
  if (res.uid !== me.uid) throw new Error('reauth-required');
  await signInWithCustomToken(auth, res.customToken);
  await auth.currentUser?.getIdToken(true);
  phoneReauth = null;
}
