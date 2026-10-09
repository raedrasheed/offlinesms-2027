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
} as const;

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
