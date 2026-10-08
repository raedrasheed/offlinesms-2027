// Auth helpers (mobile).
//
// Public phone sign-in/registration is DISABLED on the server: requestPhoneOtp /
// verifyPhoneOtp always answer `phone-signin-disabled`. The former Firebase
// native phone-auth path (signInWithPhoneNumber + reCAPTCHA verifier) was dead
// code and has been removed so no client path can trigger a Firebase-sent SMS.
// Existing accounts add a phone number from Settings (lib/phoneLink.ts).
//
// SECURITY: all callable error codes are mapped to product-friendly strings so
// low-level SDK error messages never leak into the UI.

import { signInWithCustomToken } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth, app } from './firebase';
import { setOffline } from '../services/presenceService';
import { unregisterForPush } from './notifications';

// ── OTP over relay (custom-token phone sign-in; no Firebase phone auth) ──
const fns = () => getFunctions(app, 'us-central1');

/** Request a sign-in OTP, sent via the OfflineSMS relay. */
export async function requestPhoneOtp(phoneE164: string): Promise<void> {
  await httpsCallable<{ phoneE164: string }, { ok: boolean }>(fns(), 'requestPhoneOtp')({ phoneE164 });
}

/**
 * The ISO alpha-2 countries phone sign-in is currently possible for (the OTP
 * org has a live relay serving them). The sign-in country picker shows ONLY
 * these — empty means no country is available right now.
 */
export async function getSupportedPhoneCountries(): Promise<string[]> {
  const res = await httpsCallable<Record<string, never>, { countries: string[] }>(
    fns(), 'getSupportedPhoneCountries',
  )({});
  return Array.isArray(res.data?.countries) ? res.data.countries : [];
}

/** Verify the OTP and sign in with the returned custom token. */
export async function verifyPhoneOtpAndSignIn(phoneE164: string, code: string): Promise<void> {
  const res = await httpsCallable<{ phoneE164: string; code: string }, { customToken: string }>(
    fns(), 'verifyPhoneOtp',
  )({ phoneE164, code });
  await signInWithCustomToken(auth, res.data.customToken);
}

// Sign-in is limited to the mobile prefixes the relay serves. The national
// (significant) number — trunk "0" stripped — must start with one of these.
// Keep in sync with functions/src/auth/otpLogic.ts SIGNIN_ALLOWED_PREFIXES.
export const SIGNIN_ALLOWED_PREFIXES = ['59', '56'] as const;

/**
 * True when a locally-entered national number is a supported sign-in number:
 * once the leading trunk "0" is stripped it must start with 59 or 56. Used to
 * block the request client-side before it ever reaches the relay (the backend
 * enforces the same rule and returns "number-not-supported").
 */
export function isSupportedSignInLocalNumber(localDigits: string): boolean {
  const n = (localDigits ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return n.length > 0 && SIGNIN_ALLOWED_PREFIXES.some(p => n.startsWith(p));
}

/** Map an OTP callable error (message or code) to user-facing copy. */
export function otpErrorCopy(reason?: string): string {
  switch (reason) {
    case 'phone-signin-disabled':  return 'Phone sign-in is no longer available. Please continue with email.';
    case 'phone-invalid':          return 'Enter a valid phone number.';
    case 'number-not-supported':   return 'Not supported number.';
    case 'otp-not-configured':     return 'Phone sign-in isn’t available yet. Please use email.';
    case 'no-relay-for-country':   return 'Sign-in isn’t available in your country yet (no relay).';
    case 'otp-cooldown':           return 'Please wait a moment before requesting another code.';
    case 'otp-rate-limited':       return 'Too many codes requested. Try again later.';
    case 'otp-not-requested':      return 'Request a code first.';
    case 'otp-expired':            return 'That code expired — request a new one.';
    case 'otp-too-many-attempts':  return 'Too many attempts — request a new code.';
    case 'otp-incorrect':
    case 'code-invalid':           return 'Incorrect code. Try again.';
    default:                       return 'Something went wrong. Please try again.';
  }
}

// ── Email OTP (custom-token passwordless email sign-in) ──────────────────────

// Conservative client-side email shape check (the server re-validates).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True for a plausibly-valid email address (trimmed). */
export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.length > 0 && trimmed.length <= 254 && EMAIL_RE.test(trimmed);
}

/** Request a sign-in OTP, emailed to the address. */
export async function requestEmailOtp(email: string): Promise<void> {
  await httpsCallable<{ email: string }, { ok: boolean }>(fns(), 'requestEmailOtp')({ email: email.trim() });
}

/** Resend a sign-in OTP (same call as request; the server enforces cooldown). */
export async function resendEmailOtp(email: string): Promise<void> {
  await requestEmailOtp(email);
}

/** Verify the emailed OTP and sign in with the returned custom token. */
export async function verifyEmailOtpAndSignIn(email: string, code: string): Promise<void> {
  const res = await httpsCallable<{ email: string; code: string }, { customToken: string }>(
    fns(), 'verifyEmailOtp',
  )({ email: email.trim(), code });
  await signInWithCustomToken(auth, res.data.customToken);
}

/** Map an email-OTP callable error (message or code) to user-facing copy. */
export function emailOtpErrorCopy(reason?: string): string {
  switch (reason) {
    case 'email-invalid':          return 'Enter a valid email address.';
    case 'email-signin-disabled':  return 'Email sign-in isn’t available right now.';
    case 'email-send-failed':      return 'We couldn’t send the email. Please try again.';
    case 'otp-cooldown':           return 'Please wait a moment before requesting another code.';
    case 'otp-rate-limited':       return 'Too many codes requested. Try again later.';
    case 'otp-not-requested':      return 'Request a code first.';
    case 'otp-expired':            return 'That code expired — request a new one.';
    case 'otp-too-many-attempts':  return 'Too many attempts — request a new code.';
    case 'otp-incorrect':
    case 'code-invalid':           return 'Incorrect code. Try again.';
    default:                       return 'Something went wrong. Please try again.';
  }
}

/**
 * Permanently delete the current user's account. Stops push/presence while
 * still authenticated, asks the server to erase the account + free the
 * username, then clears local auth (which routes back to Welcome).
 */
export async function deleteMyAccount(): Promise<void> {
  const uid = auth.currentUser?.uid;
  try { await setOffline(); } catch { /* best-effort */ }
  try { if (uid) await unregisterForPush(uid); } catch { /* best-effort */ }
  await httpsCallable<Record<string, never>, { ok: boolean }>(fns(), 'deleteMyAccount')({});
  try { await auth.signOut(); } catch { /* the server already deleted the user */ }
}

export async function signOut() {
  // Stamp a final lastSeen (and stop the heartbeat) while still authenticated,
  // so peers see the user go offline rather than "stuck online".
  try { await setOffline(); } catch { /* best-effort */ }
  // Disable this device's push token so a logged-out device stops receiving.
  try {
    const uid = auth.currentUser?.uid;
    if (uid) await unregisterForPush(uid);
  } catch { /* best-effort */ }
  return auth.signOut();
}
