// Shared gates for the phone-link callables: feature state, caller identity,
// account standing and sign-in freshness. Every check is server-side, against
// the verified ID token and the Admin-SDK user record (never client claims).
//
// Error codes (HttpsError.message) are stable and mapped to Arabic/English copy
// in the mobile app (apps/mobile/src/lib/phoneLink.ts).

import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { loadPhoneLinkConfig, type PhoneLinkConfig } from './config';

export const PHONE_LINK_COLLECTIONS = {
  challenges: 'phoneLinkChallenges', // {uid}       — one live challenge per account
  claims: 'phoneClaims',             // {phoneHmac} — server-side number ownership
  ops: 'phoneLinkOps',               // {uid}       — link state machine / recovery
  limits: 'smsRateLimits',           // {scope_key} — abuse counters
} as const;

/** Sign-in providers that are not an email account (or not a person). */
const REJECTED_PROVIDERS = new Set(['anonymous', 'phone']);

export interface Caller {
  uid: string;
  user: UserRecord;
  authTimeSec: number;
  appCheckPresent: boolean;
}

/** Load config or fail closed with `service-paused`. */
export async function requireConfig(db: Firestore): Promise<PhoneLinkConfig> {
  try {
    return await loadPhoneLinkConfig(db);
  } catch {
    throw new HttpsError('unavailable', 'service-paused');
  }
}

/** Pure: is the sign-in recent enough, and not revoked since? */
export function authFreshness(
  authTimeSec: unknown, nowMs: number, maxAgeSec: number, tokensValidAfterTime?: string,
): 'ok' | 'reauth-required' {
  if (typeof authTimeSec !== 'number' || !Number.isFinite(authTimeSec)) return 'reauth-required';
  const ageSec = nowMs / 1000 - authTimeSec;
  if (ageSec > maxAgeSec || ageSec < -300) return 'reauth-required';
  if (tokensValidAfterTime) {
    const validAfterSec = Math.floor(Date.parse(tokensValidAfterTime) / 1000);
    if (Number.isFinite(validAfterSec) && authTimeSec < validAfterSec) return 'reauth-required';
  }
  return 'ok';
}

/**
 * Pure: the public profile must exist and be `active`. Profiles created before
 * the `status` field existed carry no status at all and are treated as active
 * (setUserStatus only ever writes 'active' | 'suspended'); any other value —
 * 'suspended' or anything unexpected — is refused.
 */
export function profileIsActive(exists: boolean, status: unknown): boolean {
  if (!exists) return false;
  return status === undefined || status === null || status === 'active';
}

/** Pure: does the Auth record carry a verified email or a phone number? */
export function hasVerifiedSignInMethod(user: { email?: string | null; emailVerified?: boolean; phoneNumber?: string | null }): boolean {
  return (!!user.email && user.emailVerified === true) || !!user.phoneNumber;
}

/**
 * The caller must be: authenticated; a person (not a relay device); not an
 * anonymous/native-phone sign-in; recently (re)authenticated; Auth-enabled;
 * holding a verified sign-in method (verified email, or a phone number) per the
 * Admin user record; and `active` in users/{uid}.
 */
export async function requireEligibleCaller(
  request: CallableRequest<unknown>,
  db: Firestore,
  maxAuthAgeSec: number,
  nowMs = Date.now(),
  opts: { skipFreshness?: boolean } = {},
): Promise<Caller> {
  const auth = request.auth;
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'auth-required');
  const token = auth.token as Record<string, unknown> & { firebase?: { sign_in_provider?: string } };
  if (token.relayDevice === true) throw new HttpsError('permission-denied', 'not-allowed');
  const provider = token.firebase?.sign_in_provider ?? '';
  if (REJECTED_PROVIDERS.has(provider)) throw new HttpsError('failed-precondition', 'email-account-required');

  let user: UserRecord;
  try {
    user = await getAuth().getUser(auth.uid);
  } catch {
    throw new HttpsError('unauthenticated', 'auth-required');
  }
  if (user.disabled) throw new HttpsError('permission-denied', 'account-disabled');
  // skipFreshness: only for a caller that proved, by other means, that it may
  // continue despite a revoked/aged session (email-change recovery). Every
  // other standing check below still applies.
  if (!opts.skipFreshness && authFreshness(token.auth_time, nowMs, maxAuthAgeSec, user.tokensValidAfterTime) !== 'ok') {
    throw new HttpsError('unauthenticated', 'reauth-required');
  }
  // The account must already hold a verified sign-in method: a verified email
  // (email-registered) or a phone number (phone-registered: Auth only carries
  // a number after a verified code).
  if (!hasVerifiedSignInMethod(user)) {
    throw new HttpsError('failed-precondition', 'email-not-verified');
  }
  const profile = await db.collection('users').doc(auth.uid).get();
  if (!profileIsActive(profile.exists, profile.get('status'))) {
    throw new HttpsError('permission-denied', 'account-disabled');
  }
  return {
    uid: auth.uid,
    user,
    authTimeSec: token.auth_time as number,
    appCheckPresent: !!request.app,
  };
}
