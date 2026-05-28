// Pure, Firestore-free relay helpers — unit-testable in isolation (mirrors the
// recipients.ts pattern). No firebase-admin imports here.

import { ADMIN_ROLES } from '../lib/roles';

export type RelayJobStatus =
  | 'queued' | 'claimed' | 'sending' | 'sent' | 'delivered' | 'failed' | 'expired';
export type RelayReportStatus = 'sent' | 'delivered' | 'failed';

export const PAIRING_CODE_TTL_MS = 15 * 60 * 1000; // 15 min
export const LEASE_TTL_MS        = 2 * 60 * 1000;  // 2 min claim lease
export const HEARTBEAT_STALE_MS  = 90 * 1000;      // offline if no heartbeat
export const DEFAULT_MAX_ATTEMPTS = 3;

/** Stable, idempotent job id for a (batch, recipient) pair. */
export function makeJobId(batchId: string, recipientUid: string): string {
  return `${batchId}:${recipientUid}`;
}

/** Unambiguous pairing code (no 0/O/1/I/L). Not a security token on its own —
 *  it's short-lived, one-time, and scoped to a business server-side. */
export function generatePairingCode(rand: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(rand() * alphabet.length)];
  return out;
}

export function isPairingCodeUsable(
  code: { used?: boolean; expiresAtMs: number } | null,
  nowMs: number,
): boolean {
  if (!code) return false;
  if (code.used === true) return false;
  return code.expiresAtMs > nowMs;
}

export function leaseExpiryMs(nowMs: number, ttlMs = LEASE_TTL_MS): number {
  return nowMs + ttlMs;
}

export function isLeaseExpired(leaseExpiresAtMs: number | null | undefined, nowMs: number): boolean {
  if (leaseExpiresAtMs == null) return true;
  return leaseExpiresAtMs <= nowMs;
}

export function isHeartbeatStale(lastHeartbeatMs: number | null | undefined, nowMs: number): boolean {
  if (lastHeartbeatMs == null) return true;
  return nowMs - lastHeartbeatMs > HEARTBEAT_STALE_MS;
}

/** Remaining daily send capacity for a device (minute/hour pacing is enforced
 *  device-side; the server guards the hard daily cap). */
export function capacityRemaining(
  caps: { maxPerDay: number },
  counters: { sentToday: number },
  requested: number,
): number {
  const dailyLeft = Math.max(0, caps.maxPerDay - (counters.sentToday ?? 0));
  return Math.max(0, Math.min(requested, dailyLeft));
}

export interface AuthTokenLike { role?: unknown; organizationId?: unknown }

export function isSuperAdmin(token: AuthTokenLike | undefined): boolean {
  return token?.role === 'super_admin';
}

/** May the caller manage relay resources for `businessId`? */
export function canManageBusiness(token: AuthTokenLike | undefined, businessId: string): boolean {
  if (!token) return false;
  if (token.role === 'super_admin') return true;
  return token.role === 'organization_admin'
    && typeof token.organizationId === 'string'
    && token.organizationId === businessId
    && !!businessId;
}

/** Resolve the businessId the caller is acting for (null if not permitted). */
export function resolveBusinessId(
  token: AuthTokenLike | undefined,
  requestedBusinessId?: string | null,
): string | null {
  if (!token || typeof token.role !== 'string') return null;
  if (!(ADMIN_ROLES as readonly string[]).includes(token.role)) {
    // Only org/platform admins operate relays (business-only product rule).
    if (token.role !== 'organization_admin' && token.role !== 'super_admin') return null;
  }
  if (token.role === 'super_admin') {
    return requestedBusinessId || (typeof token.organizationId === 'string' ? token.organizationId : null);
  }
  if (token.role === 'organization_admin' && typeof token.organizationId === 'string') {
    return token.organizationId;
  }
  return null;
}

export function normalizeReportStatus(s: unknown): RelayReportStatus | null {
  return s === 'sent' || s === 'delivered' || s === 'failed' ? s : null;
}

/** Map a relay report to the existing recipient smsStatus vocabulary. */
export function recipientStatusFor(report: RelayReportStatus): 'sent' | 'delivered' | 'failed' {
  return report; // identical vocabulary on purpose
}

/** Terminal job states: no further transitions / safe to purge body. */
export function isTerminalJobStatus(s: RelayJobStatus): boolean {
  return s === 'delivered' || s === 'failed' || s === 'expired';
}

/** Idempotency guard: should we apply `next` over the current status? */
export function shouldApplyReport(current: RelayJobStatus, next: RelayReportStatus): boolean {
  if (isTerminalJobStatus(current)) return false;     // already settled
  if (current === 'sent' && next === 'sent') return false; // duplicate sent
  return true;
}

// ── Retry classification + backoff + reaper decisions ───────────────────────
export type FailureClass = 'transient' | 'permanent';

export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 10 * 60 * 1000;

// Android SmsManager sent-intent result codes.
const ANDROID_GENERIC_FAILURE = 1;
const ANDROID_NULL_PDU = 2;
const ANDROID_RADIO_OFF = 3;
const ANDROID_NO_SERVICE = 4;
const ANDROID_LIMIT_EXCEEDED = 5;
const ANDROID_FDN_CHECK_FAILURE = 6;

/** Classify a send failure as retryable (transient) or not (permanent).
 *  Unknown causes default to transient so they retry up to maxAttempts. */
export function classifyFailure(resultCode?: number | null, reason?: string | null): FailureClass {
  const r = (reason ?? '').toLowerCase();
  if (/invalid|permission|revoked|disabled|null-pdu|fdn|blocked|forbidden|opt-out/.test(r)) return 'permanent';
  if (resultCode === ANDROID_NULL_PDU || resultCode === ANDROID_FDN_CHECK_FAILURE) return 'permanent';
  if (/no-service|radio|network|timeout|unavailable|generic|rate|limit/.test(r)) return 'transient';
  if (resultCode === ANDROID_NO_SERVICE || resultCode === ANDROID_RADIO_OFF
    || resultCode === ANDROID_GENERIC_FAILURE || resultCode === ANDROID_LIMIT_EXCEEDED) return 'transient';
  return 'transient';
}

/** Exponential backoff before the next attempt may be claimed. */
export function backoffMs(attempts: number): number {
  const n = Math.max(1, attempts);
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, n - 1));
}

/** Outcome of a failed send report: requeue (retry) or terminal fail. */
export function failureOutcome(
  attempts: number, maxAttempts: number, cls: FailureClass,
): 'requeue' | 'fail' {
  if (cls === 'permanent') return 'fail';
  return attempts < maxAttempts ? 'requeue' : 'fail';
}

/** Reaper decision for a job whose lease may have lapsed. */
export function reapDecision(
  job: { status: RelayJobStatus; leaseExpiresAtMs: number | null; attempts: number; maxAttempts: number },
  nowMs: number,
): 'none' | 'requeue' | 'fail' {
  if (job.status !== 'claimed' && job.status !== 'sending') return 'none';
  if (job.leaseExpiresAtMs == null || job.leaseExpiresAtMs > nowMs) return 'none';
  return job.attempts >= job.maxAttempts ? 'fail' : 'requeue';
}

/** A job is claimable only once its backoff window (nextAttemptAt) has passed. */
export function isClaimable(nextAttemptAtMs: number | null | undefined, nowMs: number): boolean {
  return nextAttemptAtMs == null || nextAttemptAtMs <= nowMs;
}

/** UTC yyyymmdd — used to roll device counters over at midnight UTC. */
export function utcDayKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

// ── Multi-device routing (Phase 5) ──────────────────────────────────────────
export type SmsProviderMode = 'http' | 'relay' | 'relay_with_http_fallback';

export function relayModeEngaged(mode: SmsProviderMode): boolean {
  return mode === 'relay' || mode === 'relay_with_http_fallback';
}
export function isHybrid(mode: SmsProviderMode): boolean {
  return mode === 'relay_with_http_fallback';
}

/** Remaining daily send budget for a device (today). */
export function deviceRemaining(caps: { maxPerDay: number }, counters: { sentToday?: number }): number {
  return Math.max(0, caps.maxPerDay - (counters.sentToday ?? 0));
}

/** A device may receive jobs only if active, fresh, and under its daily cap. */
export function isDeviceRoutable(
  d: { status: string; lastHeartbeatMs: number | null; remaining: number },
  nowMs: number,
): boolean {
  return d.status === 'active' && !isHeartbeatStale(d.lastHeartbeatMs, nowMs) && d.remaining > 0;
}

export interface RouteDevice { deviceId: string; remaining: number }
export interface RouteResult { assignments: Array<{ uid: string; deviceId: string }>; unrouted: string[] }

/**
 * A relay batch is finalizable exactly once: only when it's still 'sending'
 * (relay batches are NOT set 'accepted' at dispatch, so the existing settlement
 * trigger fires once on sending→completed), it hasn't been finalized before,
 * and no relay job is still in flight.
 */
export function relayBatchFinalizable(
  nonTerminalJobCount: number,
  alreadyFinalized: boolean,
  batchStatus: string,
): boolean {
  return nonTerminalJobCount === 0 && !alreadyFinalized && batchStatus === 'sending';
}

/** Least-loaded routing: each recipient goes to the routable device with the
 *  most remaining capacity; capacity is decremented as we assign. Recipients
 *  with no remaining capacity anywhere are returned as `unrouted`. */
export function routeLeastLoaded(recipientUids: string[], devices: RouteDevice[]): RouteResult {
  const pool = devices.map(d => ({ ...d }));
  const assignments: Array<{ uid: string; deviceId: string }> = [];
  const unrouted: string[] = [];
  for (const uid of recipientUids) {
    let best: { deviceId: string; remaining: number } | null = null;
    for (const d of pool) if (d.remaining > 0 && (!best || d.remaining > best.remaining)) best = d;
    if (!best) { unrouted.push(uid); continue; }
    assignments.push({ uid, deviceId: best.deviceId });
    best.remaining -= 1;
  }
  return { assignments, unrouted };
}
