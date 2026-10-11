// Helpers shared by the phone-link callables (Admin SDK; not pure).

import { HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getAuth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { normalizePhoneAndCountry } from '../lib/phoneCountry';
import { isSupportedSignInNumber } from '../auth/otpLogic';
import { assertPepper } from './crypto';
import { PHONE_LINK_COLLECTIONS } from './gates';

export const REGION = 'us-central1';

/** Server-only HMAC key (Secret Manager). Name only — never commit a value. */
export const PHONE_HASH_PEPPER = defineSecret('PHONE_HASH_PEPPER');

/** The pepper, or `service-paused` when it is missing/weak (fail closed). */
export function requirePepper(): string {
  try {
    return assertPepper(PHONE_HASH_PEPPER.value());
  } catch {
    console.error('[phoneLink] PHONE_HASH_PEPPER is not configured; refusing');
    throw new HttpsError('unavailable', 'service-paused');
  }
}

export interface LinkNumber { e164: string; countryCode: string }

/**
 * Pure: normalize user input to E.164 with libphonenumber-js (the single
 * normalizer used for storage, uniqueness keys and delivery) and apply the
 * supported-number rule (valid number, detectable country, 59/56 mobile
 * prefix). Anything else → null ("number-not-supported").
 */
export function normalizeLinkNumber(input: unknown): LinkNumber | null {
  if (typeof input !== 'string' || input.length > 32) return null;
  const n = normalizePhoneAndCountry(input);
  if (!n.isValid || !n.e164 || !n.countryCode) return null;
  const national = parsePhoneNumberFromString(n.e164)?.nationalNumber ?? '';
  if (!isSupportedSignInNumber(n.countryCode, national)) return null;
  return { e164: n.e164, countryCode: n.countryCode };
}

function authErrorCode(e: unknown): string {
  return (e as { code?: string })?.code ?? (e as { errorInfo?: { code?: string } })?.errorInfo?.code ?? '';
}

/**
 * Is this number already associated with a DIFFERENT account, through Firebase
 * Auth (legacy phone sign-in users, earlier links) or a private profile? The
 * answer is only ever surfaced as the generic `phone-unavailable`.
 */
export async function numberHeldByOtherAccount(db: Firestore, uid: string, e164: string): Promise<boolean> {
  try {
    const u = await getAuth().getUserByPhoneNumber(e164);
    if (u.uid !== uid) return true;
  } catch (e) {
    if (authErrorCode(e) !== 'auth/user-not-found') throw e;
  }
  const snap = await db.collectionGroup('userPrivate').where('phoneNumber', '==', e164).limit(5).get();
  for (const d of snap.docs) {
    const owner = d.ref.parent.parent?.id;
    if (!owner || owner === uid) continue;
    // A private profile orphaned by an older account deletion doesn't hold
    // the number; only a live Auth user does.
    try {
      await getAuth().getUser(owner);
      return true;
    } catch (e) {
      if (authErrorCode(e) !== 'auth/user-not-found') throw e;
    }
  }
  return false;
}

/**
 * A claim whose owning Auth user no longer exists is stale (account deleted
 * before cleanup ran) and may be taken over. Returns that dead uid, or null.
 * The transaction re-checks that the claim still names exactly this uid.
 */
export async function staleClaimOwner(db: Firestore, phoneKey: string, uid: string): Promise<string | null> {
  const snap = await db.collection(PHONE_LINK_COLLECTIONS.claims).doc(phoneKey).get();
  const owner = snap.exists ? (snap.get('uid') as string | undefined) : undefined;
  if (!owner || owner === uid) return null;
  try {
    await getAuth().getUser(owner);
    return null;
  } catch (e) {
    return authErrorCode(e) === 'auth/user-not-found' ? owner : null;
  }
}

export { authErrorCode };
