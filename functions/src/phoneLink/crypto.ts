// Keyed hashing for phone linking. Pure (node:crypto only) and unit-testable.
//
// Phone numbers have a tiny keyspace (~10^9 per country), so a plain hash of a
// number is reversible by enumeration. Every identifier derived from a phone
// number or an IP — rate-limit doc ids, claim doc ids, audit targets — is an
// HMAC under the server-only secret PHONE_HASH_PEPPER instead. The OTP verifier
// is an HMAC over the code AND everything the code is bound to (challenge id,
// uid, purpose, destination), so a stored verifier is useless for any other
// challenge, user, purpose or number even if the challenge doc were read.

import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const PHONE_LINK_PURPOSE = 'link' as const;
export const OTP_LENGTH = 6;
export const MIN_PEPPER_LENGTH = 32;

/** Reject a missing/weak pepper so a misconfigured deploy fails closed. */
export function assertPepper(pepper: string | undefined | null): string {
  if (typeof pepper !== 'string' || pepper.length < MIN_PEPPER_LENGTH) {
    throw new Error('PHONE_HASH_PEPPER missing or too short');
  }
  return pepper;
}

function hmacHex(pepper: string, label: string, value: string): string {
  return createHmac('sha256', pepper).update(`${label}\u0000${value}`).digest('hex');
}

/** Stable keyed id for an E.164 number (64 hex chars). */
export function phoneHmac(pepper: string, e164: string): string {
  return hmacHex(pepper, 'phone:v1', e164);
}

/** Stable keyed id for a request-source bucket (32 hex chars). */
export function sourceHmac(pepper: string, bucket: string): string {
  return hmacHex(pepper, 'source:v1', bucket).slice(0, 32);
}

/** Short, non-reversible tag for audit rows and logs (never the number). */
export function auditTag(hmacHex: string): string {
  return hmacHex.slice(0, 16);
}

/** Uniform 6-digit code from the CSPRNG (crypto.randomInt has no modulo bias). */
export function generateCode(len = OTP_LENGTH): string {
  let out = '';
  for (let i = 0; i < len; i++) out += randomInt(0, 10).toString();
  return out;
}

/** Unguessable challenge id (128 bits). */
export function newChallengeId(): string {
  return randomBytes(16).toString('hex');
}

export interface CodeBinding {
  challengeId: string;
  /** Account uid (link) or pre-auth session key (public sign-in). */
  uid: string;
  purpose: typeof PHONE_LINK_PURPOSE | 'signin';
  phoneKey: string;
}

/** 256-bit opaque bearer token (base64url) — e.g. a pre-auth session token. */
export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Keyed id under which a bearer token is stored (the token itself never is). */
export function tokenKey(pepper: string, label: string, token: string): string {
  return hmacHex(pepper, `token:${label}:v1`, token);
}

/** Verifier stored instead of the code, bound to its full context. */
export function codeVerifier(pepper: string, b: CodeBinding, code: string): string {
  return hmacHex(pepper, 'code:v1', `${b.challengeId}|${b.uid}|${b.purpose}|${b.phoneKey}|${code}`);
}

/** Constant-time check of a submitted code against the stored verifier. */
export function verifyCode(pepper: string, b: CodeBinding, code: string, expected: string): boolean {
  if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/.test(expected)) return false;
  const actual = codeVerifier(pepper, b, code);
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

/** "+970•••••456" — for showing a user THEIR OWN number back. Never logged. */
export function maskPhone(e164: string): string {
  if (typeof e164 !== 'string' || e164.length < 8) return '•••';
  return `${e164.slice(0, 4)}${'•'.repeat(Math.max(3, e164.length - 7))}${e164.slice(-3)}`;
}
