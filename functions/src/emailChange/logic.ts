// Pure helpers for adding or changing the email on an EXISTING account
// (no Firestore / Auth here, so they are unit-testable).
//
// A code is bound to its full context — challenge id, account uid, purpose and
// the destination address — so a code issued for one address/account/purpose
// can never verify another, and a sign-in code can never confirm a change.

import { createHash, timingSafeEqual } from 'node:crypto';
import {
  bumpWindow, windowCount, distinctAllows, addDistinct, HOUR_MS, DAY_MS,
  type Win, type DistinctSet, type LimitRejection,
} from '../phoneLink/limits';

export const EMAIL_CHANGE_PURPOSE = 'email-change' as const;

export const EMAIL_CHANGE_COLLECTIONS = {
  challenges: 'emailChangeChallenges', // {uid} — one live challenge per account (hashed code)
  ops: 'emailChangeOps',               // {uid} — change state machine / recovery
  limits: 'emailChangeLimits',         // {acct_uid} — per-account abuse counters
} as const;

export const EMAIL_CHANGE_LIMITS = {
  codeTtlSec: 600,
  maxVerifyAttempts: 5,
  accountVerifyFailuresPerDay: 10,
  accountCooldownSec: 60,
  accountPerHour: 3,
  accountPerDay: 6,
  accountDistinctEmailsPerDay: 3,
  /** How recent the caller's sign-in must be to start a change (seconds). */
  reauthMaxAgeSec: 600,
  /** Revoked-session recovery of an accepted change: how long, how many tokens. */
  recoveryWindowSec: 900,
  maxRecoveryUses: 3,
  /** A worker must start its Auth write within this long of claiming it, or not at all. */
  authWriteDeadlineMs: 20_000,
  /** A write call slower than this cannot bound its own revocation marker. */
  markerMaxWriteMs: 2_000,
} as const;

export const EMAIL_CHANGE_FN_TIMEOUT_SEC = 60;

export interface EmailChangeAccountCounter {
  lastAt?: number;
  h?: Win; d?: Win;
  nd?: DistinctSet; // distinct destination addresses per day
  vf?: Win;         // wrong codes per day across challenges
}

export interface EmailCodeBinding { challengeId: string; uid: string; emailKey: string }

/** Salted, context-bound hash stored instead of the code. */
export function emailChangeVerifier(b: EmailCodeBinding, code: string, salt: string): string {
  return createHash('sha256')
    .update(`${EMAIL_CHANGE_PURPOSE}:v1|${b.challengeId}|${b.uid}|${b.emailKey}|${code}|${salt}`)
    .digest('hex');
}

/** Constant-time check of a submitted code against the stored verifier. */
export function emailChangeCodeMatches(b: EmailCodeBinding, code: string, salt: unknown, expected: unknown): boolean {
  if (typeof salt !== 'string' || typeof expected !== 'string' || !/^[0-9a-f]{64}$/.test(expected)) return false;
  const actual = emailChangeVerifier(b, code, salt);
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function retryAfter(w: Win | DistinctSet | undefined, now: number, windowMs: number): number {
  return w ? Math.max(1, Math.ceil((w.s + windowMs - now) / 1000)) : 1;
}

/** Per-account send limits for change codes. */
export function checkEmailChangeAccount(a: EmailChangeAccountCounter, emailKey: string, now: number): LimitRejection | null {
  const L = EMAIL_CHANGE_LIMITS;
  if (typeof a.lastAt === 'number') {
    const left = a.lastAt + L.accountCooldownSec * 1000 - now;
    if (left > 0) return { code: 'cooldown', scope: 'account', retryAfterSec: Math.ceil(left / 1000) };
  }
  if (windowCount(a.h, now, HOUR_MS) >= L.accountPerHour) return { code: 'rate-limited', scope: 'account', retryAfterSec: retryAfter(a.h, now, HOUR_MS) };
  if (windowCount(a.d, now, DAY_MS) >= L.accountPerDay) return { code: 'rate-limited', scope: 'account', retryAfterSec: retryAfter(a.d, now, DAY_MS) };
  if (!distinctAllows(a.nd, emailKey, now, DAY_MS, L.accountDistinctEmailsPerDay)) {
    return { code: 'too-many-numbers', scope: 'account', retryAfterSec: retryAfter(a.nd, now, DAY_MS) };
  }
  return null;
}

export function applyEmailChangeAccount(a: EmailChangeAccountCounter, emailKey: string, now: number): EmailChangeAccountCounter {
  return {
    ...a,
    lastAt: Math.max(a.lastAt ?? 0, now),
    h: bumpWindow(a.h, now, HOUR_MS),
    d: bumpWindow(a.d, now, DAY_MS),
    nd: addDistinct(a.nd, emailKey, now, DAY_MS),
  };
}

export function emailChangeVerifyExhausted(a: EmailChangeAccountCounter, now: number): boolean {
  return windowCount(a.vf, now, DAY_MS) >= EMAIL_CHANGE_LIMITS.accountVerifyFailuresPerDay;
}

export function applyEmailChangeVerifyFailure(a: EmailChangeAccountCounter, now: number): EmailChangeAccountCounter {
  return { ...a, vf: bumpWindow(a.vf, now, DAY_MS) };
}

/** "ra•••@example.com" — for showing a user THEIR OWN address back. Never logged. */
export function maskEmail(email: string): string {
  const at = typeof email === 'string' ? email.lastIndexOf('@') : -1;
  if (at < 1) return '•••';
  const local = email.slice(0, at);
  return `${local.slice(0, Math.min(2, local.length))}•••${email.slice(at)}`;
}

// ── Revoked-session recovery ─────────────────────────────────────────────────
// Firebase revokes every session when the account's email changes, including
// the one making the change. If the response that carries the replacement token
// is lost, the device may finish with a dedicated recovery proof — a random key
// it generated and sent with the verify — and only while the account's
// revocation marker (tokensValidAfterTime) is EXACTLY the one this change's own
// Auth write produced. The worker reads the marker back after its write and
// keeps it only if it falls inside the seconds of the write call itself
// (ownRevocationMarker), so a revocation between the write and the read-back
// is never taken for the change's own. Any other revocation (sign-out
// everywhere, password change, a repair write, a later change) moves the
// marker and ends the recovery; when no own marker could be established
// recovery is refused and the device signs in again normally.

export const RECOVERY_KEY_RE = /^[0-9a-f]{64}$/;

export function recoveryKeyHash(key: string): string {
  return createHash('sha256').update(`email-change-recovery:v1|${key}`).digest('hex');
}

export function recoveryKeyMatches(key: unknown, hash: unknown): boolean {
  if (typeof key !== 'string' || !RECOVERY_KEY_RE.test(key) || typeof hash !== 'string' || hash.length !== 64) return false;
  return timingSafeEqual(Buffer.from(recoveryKeyHash(key), 'hex'), Buffer.from(hash, 'hex'));
}

export interface RecoveryOp {
  uid?: unknown; stage?: unknown; challengeId?: unknown; recoveryHash?: unknown;
  recoveryUses?: unknown; startedAtMs: number; changeValidAfter?: unknown;
}

const parseTime = (v: unknown): number => (typeof v === 'string' && v ? Date.parse(v) : NaN);

/**
 * Pure: the marker read back after this change's Auth write, ONLY if it can
 * have been produced by that write — inside the seconds the write call itself
 * spanned (Firebase keeps it at one-second resolution; ±1s for clock skew).
 * A later independent revocation, or a write call too slow to bound, yields
 * null: the change then has no recoverable marker and a revoked device signs
 * in again normally.
 */
export function ownRevocationMarker(marker: unknown, writeStartMs: number, writeEndMs: number): string | null {
  const m = parseTime(marker);
  if (!Number.isFinite(m) || !(writeEndMs >= writeStartMs)) return null;
  if (writeEndMs - writeStartMs > EMAIL_CHANGE_LIMITS.markerMaxWriteMs) return null;
  const lo = Math.floor(writeStartMs / 1000) * 1000 - 1000;
  const hi = Math.floor(writeEndMs / 1000) * 1000 + 1000;
  return m >= lo && m <= hi ? (marker as string) : null;
}

/**
 * Pure: may a caller whose session is revoked continue this op? Only the device
 * that accepted the change (holds the recovery key), for the same challenge,
 * whose sign-in predates the change, within the window and use budget, and
 * whose session was revoked by this change's own Auth write and by nothing else.
 */
export function recoveryAllowed(a: {
  op: RecoveryOp | null; uid: string; challengeId: string; recoveryKey: unknown;
  authTimeSec: unknown; tokensValidAfterTime: string | undefined; nowMs: number;
}): boolean {
  const L = EMAIL_CHANGE_LIMITS;
  const op = a.op;
  if (!op || op.uid !== a.uid || op.challengeId !== a.challengeId) return false;
  if (!['auth-updated', 'done'].includes(op.stage as string)) return false;
  if (!recoveryKeyMatches(a.recoveryKey, op.recoveryHash)) return false;
  if (typeof op.recoveryUses === 'number' && op.recoveryUses >= L.maxRecoveryUses) return false;
  if (!(op.startedAtMs > 0) || a.nowMs - op.startedAtMs > L.recoveryWindowSec * 1000) return false;
  // The session was fresh when the change was accepted (it passed the gate then).
  if (typeof a.authTimeSec !== 'number' || !Number.isFinite(a.authTimeSec)) return false;
  const authMs = a.authTimeSec * 1000;
  if (authMs > op.startedAtMs + 5_000 || op.startedAtMs - authMs > (L.reauthMaxAgeSec + L.codeTtlSec) * 1000) return false;
  // Revoked, and the marker is exactly the one this change's write produced.
  const own = parseTime(op.changeValidAfter);
  const current = parseTime(a.tokensValidAfterTime);
  if (!Number.isFinite(own) || !Number.isFinite(current)) return false;
  if (current <= authMs) return false; // not revoked → the normal gate decides
  return current === own;
}
