// Abuse-control counters for phone-link verification SMS. Pure (no Firestore):
// the request handler reads the counter docs inside ONE Firestore transaction,
// calls check*/apply* here, and writes the results back in that same
// transaction — before the relay job is created. Concurrent requests therefore
// serialize on the counter docs: two parallel calls can't both observe "one
// left" and both send.
//
// Windows are fixed, anchored at the first event after the previous window
// expired (`s` = start ms, `c` = count). Trade-off: a caller who times requests
// across a window edge can get up to 2× a window's limit in a short burst; the
// longer windows (day / 30 days) and the cooldowns bound that. Times are epoch
// milliseconds from the server clock.

import type { PhoneLinkLimits } from './config';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const THIRTY_DAYS_MS = 30 * DAY_MS;

export interface Win { s: number; c: number }
export interface DistinctSet { s: number; k: string[] }

export interface AccountCounter {
  lastAt?: number;      // last code queued for this account
  h?: Win; d?: Win;     // codes queued per hour / day
  nd?: DistinctSet;     // distinct destination keys per day
  n30?: DistinctSet;    // distinct destination keys per 30 days
  vf?: Win;             // wrong codes per day (all challenges)
}
export interface DestinationCounter { lastAt?: number; h?: Win; d?: Win }
export interface WindowCounter { h?: Win; d?: Win }

export type LimitScope = 'account' | 'destination' | 'source' | 'global';
export type LimitCode = 'cooldown' | 'rate-limited' | 'too-many-numbers' | 'service-busy';
export interface LimitRejection { code: LimitCode; scope: LimitScope; retryAfterSec: number }

function asWin(w: unknown): Win | undefined {
  const o = w as Win | undefined;
  return o && typeof o.s === 'number' && typeof o.c === 'number' ? o : undefined;
}
function asSet(v: unknown): DistinctSet | undefined {
  const o = v as DistinctSet | undefined;
  return o && typeof o.s === 'number' && Array.isArray(o.k) ? o : undefined;
}

// A window only ever expires FORWARD in time. A request whose `now` is
// slightly earlier than the window start (taken before a concurrent request
// opened the window, or on an instance with a lagging clock) counts INTO the
// current window; treating it as expired would reset the counter and let a
// burst of parallel requests overshoot the limit.
function expired(start: number, now: number, windowMs: number): boolean {
  return now - start >= windowMs;
}

/** Events counted in the window that is current at `now`. */
export function windowCount(w: Win | undefined, now: number, windowMs: number): number {
  const x = asWin(w);
  if (!x || expired(x.s, now, windowMs)) return 0;
  return x.c;
}

export function bumpWindow(w: Win | undefined, now: number, windowMs: number): Win {
  const x = asWin(w);
  if (!x || expired(x.s, now, windowMs)) return { s: now, c: 1 };
  return { s: x.s, c: x.c + 1 };
}

function windowRetry(w: Win | undefined, now: number, windowMs: number): number {
  const x = asWin(w);
  return x ? Math.max(1, Math.ceil((x.s + windowMs - now) / 1000)) : 1;
}

function setRetry(set: DistinctSet | undefined, now: number, windowMs: number): number {
  const x = asSet(set);
  return x ? Math.max(1, Math.ceil((x.s + windowMs - now) / 1000)) : 1;
}

function liveSet(set: DistinctSet | undefined, now: number, windowMs: number): DistinctSet | undefined {
  const x = asSet(set);
  return x && !expired(x.s, now, windowMs) ? x : undefined;
}

/** May `key` be used, given a cap on distinct keys in the window? */
export function distinctAllows(set: DistinctSet | undefined, key: string, now: number, windowMs: number, limit: number): boolean {
  const x = liveSet(set, now, windowMs);
  if (!x) return limit > 0;
  return x.k.includes(key) || x.k.length < limit;
}

export function addDistinct(set: DistinctSet | undefined, key: string, now: number, windowMs: number): DistinctSet {
  const x = liveSet(set, now, windowMs);
  if (!x) return { s: now, k: [key] };
  return x.k.includes(key) ? x : { s: x.s, k: [...x.k, key] };
}

function cooldownLeft(lastAt: number | undefined, now: number, cooldownSec: number): number {
  if (typeof lastAt !== 'number') return 0;
  const left = lastAt + cooldownSec * 1000 - now;
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

// ── Account ──────────────────────────────────────────────────────────────────
export function checkAccount(a: AccountCounter, destKey: string, now: number, L: PhoneLinkLimits): LimitRejection | null {
  const cd = cooldownLeft(a.lastAt, now, L.accountCooldownSec);
  if (cd > 0) return { code: 'cooldown', scope: 'account', retryAfterSec: cd };
  if (windowCount(a.h, now, HOUR_MS) >= L.accountPerHour) return { code: 'rate-limited', scope: 'account', retryAfterSec: windowRetry(a.h, now, HOUR_MS) };
  if (windowCount(a.d, now, DAY_MS) >= L.accountPerDay) return { code: 'rate-limited', scope: 'account', retryAfterSec: windowRetry(a.d, now, DAY_MS) };
  if (!distinctAllows(a.nd, destKey, now, DAY_MS, L.accountDistinctNumbersPerDay)) {
    return { code: 'too-many-numbers', scope: 'account', retryAfterSec: setRetry(a.nd, now, DAY_MS) };
  }
  if (!distinctAllows(a.n30, destKey, now, THIRTY_DAYS_MS, L.accountDistinctNumbersPer30Days)) {
    return { code: 'too-many-numbers', scope: 'account', retryAfterSec: setRetry(a.n30, now, THIRTY_DAYS_MS) };
  }
  return null;
}

/** Count one request against the account (also used for "unavailable" probes). */
export function applyAccount(a: AccountCounter, destKey: string, now: number): AccountCounter {
  return {
    ...a,
    lastAt: Math.max(a.lastAt ?? 0, now),
    h: bumpWindow(a.h, now, HOUR_MS),
    d: bumpWindow(a.d, now, DAY_MS),
    nd: addDistinct(a.nd, destKey, now, DAY_MS),
    n30: addDistinct(a.n30, destKey, now, THIRTY_DAYS_MS),
  };
}

export function verifyFailuresExhausted(a: AccountCounter, now: number, L: PhoneLinkLimits): boolean {
  return windowCount(a.vf, now, DAY_MS) >= L.accountVerifyFailuresPerDay;
}

export function applyVerifyFailure(a: AccountCounter, now: number): AccountCounter {
  return { ...a, vf: bumpWindow(a.vf, now, DAY_MS) };
}

// ── Destination number ───────────────────────────────────────────────────────
export function checkDestination(d: DestinationCounter, now: number, L: PhoneLinkLimits): LimitRejection | null {
  const cd = cooldownLeft(d.lastAt, now, L.destinationCooldownSec);
  if (cd > 0) return { code: 'cooldown', scope: 'destination', retryAfterSec: cd };
  if (windowCount(d.h, now, HOUR_MS) >= L.destinationPerHour) return { code: 'rate-limited', scope: 'destination', retryAfterSec: windowRetry(d.h, now, HOUR_MS) };
  if (windowCount(d.d, now, DAY_MS) >= L.destinationPerDay) return { code: 'rate-limited', scope: 'destination', retryAfterSec: windowRetry(d.d, now, DAY_MS) };
  return null;
}

export function applyDestination(d: DestinationCounter, now: number): DestinationCounter {
  return { ...d, lastAt: Math.max(d.lastAt ?? 0, now), h: bumpWindow(d.h, now, HOUR_MS), d: bumpWindow(d.d, now, DAY_MS) };
}

// ── Source bucket & global budget ───────────────────────────────────────────
export function checkWindows(
  w: WindowCounter, now: number, perHour: number, perDay: number, scope: 'source' | 'global',
): LimitRejection | null {
  if (windowCount(w.h, now, HOUR_MS) >= perHour) return { code: 'service-busy', scope, retryAfterSec: windowRetry(w.h, now, HOUR_MS) };
  if (windowCount(w.d, now, DAY_MS) >= perDay) return { code: 'service-busy', scope, retryAfterSec: windowRetry(w.d, now, DAY_MS) };
  return null;
}

export function applyWindows(w: WindowCounter, now: number): WindowCounter {
  return { ...w, h: bumpWindow(w.h, now, HOUR_MS), d: bumpWindow(w.d, now, DAY_MS) };
}
