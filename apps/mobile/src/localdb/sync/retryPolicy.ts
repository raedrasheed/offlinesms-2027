// Phase 22 — outbox retry policy. Pure & unit-tested.
//
// Exponential backoff with full jitter, capped. Some callable errors are
// permanent (bad input / permission) and should dead-letter immediately rather
// than burning the attempt budget.

const BASE_MS = 2000;
const CAP_MS = 5 * 60 * 1000; // 5 minutes

/** Backoff (ms) for the Nth attempt (1-based), with optional jitter. */
export function backoffMs(attempt: number, jitter = true, rng: () => number = Math.random): number {
  const exp = Math.min(CAP_MS, BASE_MS * Math.pow(2, Math.max(0, attempt - 1)));
  if (!jitter) return exp;
  return Math.floor(exp / 2 + rng() * (exp / 2));
}

export function nextAttemptAt(attempt: number, now = Date.now(), rng?: () => number): number {
  return now + backoffMs(attempt, true, rng);
}

/** Firebase callable error codes that will never succeed on retry. */
const PERMANENT_CODES = new Set([
  'invalid-argument',
  'permission-denied',
  'unauthenticated',
  'not-found',
  'failed-precondition',
  'already-exists',
]);

/** Normalise a thrown callable error to its functions error code. */
export function errorCode(err: any): string {
  const raw = (err?.code ?? err?.details?.code ?? '') as string;
  return raw.startsWith('functions/') ? raw.slice('functions/'.length) : raw;
}

export function isPermanent(err: any): boolean {
  return PERMANENT_CODES.has(errorCode(err));
}
