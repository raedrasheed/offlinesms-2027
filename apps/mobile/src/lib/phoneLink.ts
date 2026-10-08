// "Add phone number" for an existing, email-verified account. Thin client over
// the authenticated phone-link callables — every rule (eligibility, consent,
// limits, uniqueness, code checks) is enforced on the server; this module only
// calls them and re-authenticates the CURRENT user when the server asks.

import { getFunctions, httpsCallable } from 'firebase/functions';
import { signInWithCustomToken } from 'firebase/auth';
import { app, auth } from './firebase';

const fns = () => getFunctions(app, 'us-central1');

export const PHONE_LINK_CONSENT_VERSION = 'phone-link-v1';

export type PhoneLinkStatus =
  | { available: false }
  | {
      available: true;
      sendingPaused: boolean;
      linked: boolean;
      maskedPhone: string | null;
      pendingRecovery: boolean;
      eligible: boolean;
      emailVerified: boolean;
      reauthRequired: boolean;
      countries: string[];
      consentVersion: string;
      codeTtlSec: number;
      resendAfterSec: number;
    };

export async function getPhoneLinkStatus(): Promise<PhoneLinkStatus> {
  const res = await httpsCallable<Record<string, never>, PhoneLinkStatus>(fns(), 'getPhoneLinkStatus')({});
  return res.data ?? { available: false };
}

export interface PhoneLinkChallenge {
  challengeId: string; expiresAtMs: number; resendAfterSec: number; maskedPhone: string;
}

export async function requestPhoneLinkCode(phoneE164: string): Promise<PhoneLinkChallenge> {
  const res = await httpsCallable<Record<string, unknown>, PhoneLinkChallenge & { ok: boolean }>(fns(), 'requestPhoneLinkOtp')({
    phoneE164,
    ownershipConfirmed: true,
    smsConsent: true,
    consentVersion: PHONE_LINK_CONSENT_VERSION,
  });
  return res.data;
}

export async function verifyPhoneLinkCode(challengeId: string, code: string): Promise<{ linked: true; maskedPhone: string }> {
  const res = await httpsCallable<{ challengeId: string; code: string }, { linked: true; maskedPhone: string }>(
    fns(), 'verifyPhoneLinkOtp',
  )({ challengeId, code });
  return res.data;
}

export async function resumePhoneLink(): Promise<{ linked: true; maskedPhone: string }> {
  const res = await httpsCallable<Record<string, never>, { linked: true; maskedPhone: string }>(fns(), 'resumePhoneLink')({});
  return res.data;
}

/**
 * Re-authenticate the signed-in user with an emailed code (the account's sign-in
 * method), refreshing `auth_time`. Refuses — without signing in — if the code
 * belongs to any account other than the current one, so this step can never
 * switch accounts.
 */
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

/** Send the re-authentication code to the current user's own email. */
export async function sendReauthEmailCode(): Promise<void> {
  const email = auth.currentUser?.email;
  if (!email) throw new Error('reauth-required');
  await httpsCallable<{ email: string }, { ok: boolean }>(fns(), 'requestEmailOtp')({ email });
}
