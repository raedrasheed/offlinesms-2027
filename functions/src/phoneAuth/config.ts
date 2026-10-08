// Public phone sign-in / sign-up configuration — the `signin` purpose of the
// shared verification policy (smsConfig/otp; functions/src/verification/policy.ts).
//
// Sending sign-in codes requires ALL of: deploy-time env PHONE_AUTH_ENABLED=true,
// policy `enabled: true`, `emergencyStop: false` (explicit), a sender
// `businessId`, and `signin.enabled: true`. Production's current doc has none
// of these flags, so this code ships OFF and preserves the suspension.
//
// A new user has no account yet, so there is no account-level budget here.
// Abuse is bounded by layers that each hold even when another is reset:
//   pre-auth session  — opaque server-issued bearer, few codes, few numbers
//   installation id   — client-supplied, UNTRUSTED (a reinstall resets it)
//   request source    — trusted X-Forwarded-For hop, IPv4 /32, IPv6 /64
//   destination       — cooldown, hour/day caps, wrong-code cap across resends
//   global            — sign-in budget + budget shared with phone linking
// plus a server-verified proof-of-work bound to the session and the number.

import type { Firestore } from 'firebase-admin/firestore';
import {
  loadPolicyDoc, resolveShared, purposeSection, purposeEnvEnabled, resolveBounded,
} from '../verification/policy';

export interface PhoneAuthLimits {
  codeTtlSec: number;
  maxVerifyAttempts: number;
  /** Wrong codes per destination per day across every challenge/session. */
  destinationVerifyFailuresPerDay: number;
  sessionTtlSec: number;
  sessionMaxCodes: number;
  sessionMaxDestinations: number;
  sessionCooldownSec: number;
  /** New pre-auth sessions per request source per hour. */
  sourceSessionsPerHour: number;
  sourcePerHour: number;
  sourcePerDay: number;
  sourceDistinctDestinationsPerDay: number;
  installPerDay: number;
  installDistinctDestinationsPerDay: number;
  destinationCooldownSec: number;
  destinationPerHour: number;
  destinationPerDay: number;
  globalPerHour: number;
  globalPerDay: number;
  /** Proof-of-work difficulty (leading zero bits) and its adaptive ceiling. */
  powBits: number;
  powMaxBits: number;
  powTtlSec: number;
  /** How long a verified challenge may re-issue its sign-in token on retry. */
  tokenRetryWindowSec: number;
}

/** Defaults — rationale in docs/PHONE_LINKING_SECURITY.md §Thresholds. */
export const DEFAULT_SIGNIN_LIMITS: PhoneAuthLimits = {
  codeTtlSec: 300,
  maxVerifyAttempts: 5,
  destinationVerifyFailuresPerDay: 10,
  sessionTtlSec: 1800,
  sessionMaxCodes: 3,
  sessionMaxDestinations: 2,
  sessionCooldownSec: 60,
  sourceSessionsPerHour: 30,
  sourcePerHour: 20,
  sourcePerDay: 60,
  sourceDistinctDestinationsPerDay: 10,
  installPerDay: 5,
  installDistinctDestinationsPerDay: 3,
  destinationCooldownSec: 60,
  destinationPerHour: 3,
  destinationPerDay: 5,
  globalPerHour: 100,
  globalPerDay: 500,
  // 14 bits ≈ 16k hashes on average (≈0.1 s on Node/V8; Hermes on a phone is
  // slower and was not measured — tune from field data).
  powBits: 14,
  powMaxBits: 18,
  powTtlSec: 600,
  tokenRetryWindowSec: 600,
};

export const SIGNIN_LIMIT_BOUNDS: { [K in keyof PhoneAuthLimits]: [number, number] } = {
  codeTtlSec: [60, 600],
  maxVerifyAttempts: [1, 10],
  destinationVerifyFailuresPerDay: [1, 30],
  sessionTtlSec: [300, 3600],
  sessionMaxCodes: [1, 10],
  sessionMaxDestinations: [1, 5],
  sessionCooldownSec: [30, 3600],
  sourceSessionsPerHour: [1, 500],
  sourcePerHour: [0, 500],
  sourcePerDay: [0, 2000],
  sourceDistinctDestinationsPerDay: [0, 200],
  installPerDay: [0, 50],
  installDistinctDestinationsPerDay: [0, 20],
  destinationCooldownSec: [30, 3600],
  destinationPerHour: [0, 10],
  destinationPerDay: [0, 20],
  globalPerHour: [0, 2000],
  globalPerDay: [0, 10000],
  powBits: [8, 24],
  powMaxBits: [8, 26],
  powTtlSec: [60, 1800],
  tokenRetryWindowSec: [60, 1800],
};

export type AttestationMode = 'off' | 'required';

/**
 * Store-review access — the CONTROLLED replacement for the old fixed review
 * credential that was hard-coded in source. Off unless an admin writes
 * smsConfig/otp.signin.review (scripts/setReviewAccess.ts). It is:
 *   • revocable and time-boxed (`expiresAtMs`, max 30 days ahead)
 *   • one fictional number → one pre-existing demo account (`uid`); it can
 *     never create, resolve or sign into any other account
 *   • code stored as salted SHA-256 only (never in source, logs or the PR)
 *   • never sends an SMS (no relay job), and still consumes every budget
 */
export interface ReviewAccess {
  phoneE164: string;
  codeSalt: string;
  codeHash: string;
  uid: string;
  expiresAtMs: number;
}

const REVIEW_MAX_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;

export function resolveReviewAccess(raw: unknown, nowMs = Date.now()): ReviewAccess | null {
  const r = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!r || r.enabled !== true) return null;
  const ok = typeof r.phoneE164 === 'string' && /^\+[1-9]\d{6,14}$/.test(r.phoneE164)
    && typeof r.codeSalt === 'string' && r.codeSalt.length >= 16
    && typeof r.codeHash === 'string' && /^[0-9a-f]{64}$/.test(r.codeHash)
    && typeof r.uid === 'string' && r.uid.length > 0
    && typeof r.expiresAtMs === 'number' && r.expiresAtMs > nowMs && r.expiresAtMs <= nowMs + REVIEW_MAX_AHEAD_MS;
  return ok ? {
    phoneE164: r.phoneE164 as string, codeSalt: r.codeSalt as string, codeHash: r.codeHash as string,
    uid: r.uid as string, expiresAtMs: r.expiresAtMs as number,
  } : null;
}

export interface PhoneAuthConfig {
  enabled: boolean;
  emergencyStop: boolean;
  businessId: string | null;
  androidAppHash: string | null;
  policyVersion: number;
  limits: PhoneAuthLimits;
  sourceHopsFromRight: number;
  sharedPerHour: number;
  sharedPerDay: number;
  /** 'required' ⇒ requests without a verified App Check token are refused. */
  attestation: AttestationMode;
  /** Store-review access when configured, enabled and unexpired; else null. */
  review: ReviewAccess | null;
}

export function resolvePhoneAuthConfig(envEnabled: boolean, doc: Record<string, unknown> | null): PhoneAuthConfig {
  const shared = resolveShared(doc);
  const signin = purposeSection(doc, 'signin');
  const limits = resolveBounded(DEFAULT_SIGNIN_LIMITS, SIGNIN_LIMIT_BOUNDS, signin.limits);
  if (limits.powMaxBits < limits.powBits) limits.powMaxBits = limits.powBits;
  return {
    enabled: envEnabled && shared.masterEnabled && signin.enabled === true,
    emergencyStop: shared.emergencyStop,
    businessId: shared.businessId,
    androidAppHash: shared.androidAppHash,
    policyVersion: shared.policyVersion,
    limits,
    sourceHopsFromRight: shared.sourceHopsFromRight,
    sharedPerHour: shared.sharedPerHour,
    sharedPerDay: shared.sharedPerDay,
    attestation: signin.attestation === 'required' ? 'required' : 'off',
    review: resolveReviewAccess(signin.review),
  };
}

export function phoneAuthSendingAllowed(cfg: PhoneAuthConfig): boolean {
  return cfg.enabled && !cfg.emergencyStop && cfg.businessId !== null;
}

export async function loadPhoneAuthConfig(db: Firestore): Promise<PhoneAuthConfig> {
  return resolvePhoneAuthConfig(purposeEnvEnabled('signin'), await loadPolicyDoc(db));
}
