// Phone OTP flow (mobile primary).
//
// Web path: invisible reCAPTCHA via the standard `firebase/auth` web SDK.
// Native path: relies on a `FirebaseRecaptchaVerifierModal` (from
// `expo-firebase-recaptcha`) being mounted somewhere up the React tree, and
// its ref passed to `setNativeRecaptchaVerifier()` at app startup. If the
// verifier ref hasn't been registered, `sendOtp` throws a clear, recoverable
// error so the UI can surface it instead of crashing.
//
// SECURITY:
//   - Verification IDs and ConfirmationResults stay in module-scope memory;
//     they are never persisted, logged, or sent to Firestore.
//   - All Firebase error codes are mapped to product-friendly strings so the
//     low-level SDK error messages never leak into the UI.

import {
  signInWithPhoneNumber,
  RecaptchaVerifier,
  type ConfirmationResult,
  type ApplicationVerifier,
} from 'firebase/auth';
import { auth } from './firebase';
import { Platform } from 'react-native';
import { setOffline } from '../services/presenceService';

let confirmation: ConfirmationResult | null = null;
let nativeVerifier: ApplicationVerifier | null = null;

/**
 * Mount-time hook for native: register the ref of a
 * `<FirebaseRecaptchaVerifierModal>` so `sendOtp` can use it.
 */
export function setNativeRecaptchaVerifier(verifier: ApplicationVerifier | null) {
  nativeVerifier = verifier;
}

export type OtpErrorCode =
  | 'invalid-phone-number'
  | 'missing-phone-number'
  | 'invalid-verification-code'
  | 'code-expired'
  | 'too-many-attempts'
  | 'network-error'
  | 'quota-exceeded'
  | 'recaptcha-unavailable'
  | 'no-confirmation-in-flight'
  | 'cancelled'
  | 'unknown';

export class OtpError extends Error {
  code: OtpErrorCode;
  constructor(code: OtpErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'OtpError';
  }
}

function mapFirebaseError(e: unknown): OtpError {
  const code = (e as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-phone-number':       return new OtpError('invalid-phone-number');
    case 'auth/missing-phone-number':       return new OtpError('missing-phone-number');
    case 'auth/invalid-verification-code':  return new OtpError('invalid-verification-code');
    case 'auth/code-expired':               return new OtpError('code-expired');
    case 'auth/too-many-requests':          return new OtpError('too-many-attempts');
    case 'auth/network-request-failed':     return new OtpError('network-error');
    case 'auth/quota-exceeded':             return new OtpError('quota-exceeded');
    case 'auth/captcha-check-failed':       return new OtpError('recaptcha-unavailable');
    case 'auth/missing-verification-code':  return new OtpError('invalid-verification-code');
    default: return new OtpError('unknown', (e as { message?: string })?.message);
  }
}

/** Basic E.164-ish format check. We don't pre-validate carriers — Firebase does. */
export function isPlausiblePhone(phone: string): boolean {
  const trimmed = phone.replace(/\s+/g, '');
  return /^\+[1-9]\d{6,14}$/.test(trimmed);
}

export async function sendOtp(phoneNumber: string): Promise<void> {
  const normalized = phoneNumber.replace(/\s+/g, '');
  if (!isPlausiblePhone(normalized)) throw new OtpError('invalid-phone-number');

  try {
    if (Platform.OS === 'web') {
      const verifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
      confirmation = await signInWithPhoneNumber(auth, normalized, verifier);
      return;
    }

    if (!nativeVerifier) {
      throw new OtpError(
        'recaptcha-unavailable',
        'Native phone verification is not configured in this build.',
      );
    }
    confirmation = await signInWithPhoneNumber(auth, normalized, nativeVerifier);
  } catch (e) {
    if (e instanceof OtpError) throw e;
    throw mapFirebaseError(e);
  }
}

export async function verifyOtp(code: string) {
  if (!confirmation) throw new OtpError('no-confirmation-in-flight');
  const clean = code.replace(/\D/g, '');
  if (clean.length !== 6) throw new OtpError('invalid-verification-code');
  try {
    const cred = await confirmation.confirm(clean);
    return cred.user;
  } catch (e) {
    throw mapFirebaseError(e);
  }
}

/** Clear any in-flight verification state (e.g. user backs out of the flow). */
export function cancelOtp(): void {
  confirmation = null;
}

export async function signOut() {
  // Stamp a final lastSeen (and stop the heartbeat) while still authenticated,
  // so peers see the user go offline rather than "stuck online".
  try { await setOffline(); } catch { /* best-effort */ }
  return auth.signOut();
}
