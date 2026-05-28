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
