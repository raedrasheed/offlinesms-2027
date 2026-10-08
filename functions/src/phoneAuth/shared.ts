// Shared plumbing for the public phone sign-in/sign-up callables.

import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';
import { loadPhoneAuthConfig, type PhoneAuthConfig } from './config';
import { trustedClientIp, sourceBucket } from '../phoneLink/requestSource';
import { sourceHmac, tokenKey } from '../phoneLink/crypto';

export const PHONE_AUTH_COLLECTIONS = {
  sessions: 'phoneAuthSessions',     // {HMAC(sessionToken)} — pre-auth sessions
  challenges: 'phoneAuthChallenges', // {challengeId}        — code verifiers
  ops: 'phoneAuthOps',               // {challengeId}        — sign-in completion
  limits: 'smsRateLimits',           // shared counter collection
} as const;

export const SIGNIN_GLOBAL_COUNTER_ID = 'global_phoneAuth';
export const SHARED_COUNTER_ID = 'global_verification';
export const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const INSTALLATION_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export type GateMode = 'send' | 'verify';

/**
 * Load the sign-in config and apply the feature gates. `send` needs the
 * purpose enabled AND not emergency-stopped; `verify` only needs the purpose
 * enabled (checking an already-sent code sends nothing). Unreadable config ⇒
 * `service-paused` (fail closed).
 */
export async function requireSigninConfig(db: Firestore, mode: GateMode): Promise<PhoneAuthConfig> {
  let cfg: PhoneAuthConfig;
  try { cfg = await loadPhoneAuthConfig(db); } catch { throw new HttpsError('unavailable', 'service-paused'); }
  if (!cfg.enabled) throw new HttpsError('failed-precondition', 'phone-auth-unavailable');
  if (mode === 'send' && (cfg.emergencyStop || !cfg.businessId)) throw new HttpsError('unavailable', 'service-paused');
  return cfg;
}

/**
 * App Check as an OPTIONAL extra layer: when policy says `required`, a request
 * without a framework-verified App Check token (or with an already-consumed
 * limited-use token) is refused. Native clients cannot attest on this stack
 * yet, so the default is 'off' — never an unconditional bypass.
 */
export function requireAttestation(request: CallableRequest<unknown>, cfg: PhoneAuthConfig): void {
  if (cfg.attestation !== 'required') return;
  const app = request.app as { alreadyConsumed?: boolean } | undefined;
  if (!app || app.alreadyConsumed === true) throw new HttpsError('failed-precondition', 'attestation-required');
}

export function sourceKeyFor(request: CallableRequest<unknown>, pepper: string, hops: number): string {
  const raw = request.rawRequest as { headers?: Record<string, string | string[] | undefined>; ip?: string } | undefined;
  return sourceHmac(pepper, sourceBucket(trustedClientIp(raw?.headers?.['x-forwarded-for'], raw?.ip, hops)));
}

export function sessionKeyFor(pepper: string, sessionToken: unknown): string | null {
  if (typeof sessionToken !== 'string' || !SESSION_TOKEN_RE.test(sessionToken)) return null;
  return tokenKey(pepper, 'phone-auth-session', sessionToken);
}

export function installKeyFor(pepper: string, installationId: unknown): string | null {
  if (typeof installationId !== 'string' || !INSTALLATION_ID_RE.test(installationId)) return null;
  return tokenKey(pepper, 'installation', installationId).slice(0, 32);
}
