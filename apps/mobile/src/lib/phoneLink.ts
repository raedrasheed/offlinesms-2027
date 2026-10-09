// "Add phone number" for an existing, email-verified account. Thin client over
// the authenticated phone-link callables — every rule (eligibility, consent,
// limits, uniqueness, code checks) is enforced on the server; this module only
// calls them and re-authenticates the CURRENT user when the server asks.

import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase';

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

// Re-authentication lives in ./signInMethods (email or phone, whichever the
// account has); re-exported here for existing callers.
export { sendReauthEmailCode, reauthenticateWithEmailCode } from './signInMethods';
