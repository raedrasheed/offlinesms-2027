// Pure, Firestore-free relay helpers — unit-testable in isolation (mirrors the
// recipients.ts pattern). No firebase-admin imports here.

import { randomInt } from 'node:crypto';
import { ADMIN_ROLES } from '../lib/roles';
import { isSupportedCountry } from 'libphonenumber-js';

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
export function generatePairingCode(rand?: () => number): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  // CSPRNG (uniform, no modulo bias); `rand` only for deterministic tests.
  for (let i = 0; i < 8; i++) {
    out += alphabet[rand ? Math.floor(rand() * alphabet.length) : randomInt(0, alphabet.length)];
  }
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

// ── Server-owned send-capacity reservations (per device) ────────────────────
//
// Accounting unit: one CLAIMED job attempt (a logical message handed to the
// device), whatever happens afterwards — sent, failed, or ambiguous. That is
// deliberately conservative: a carrier hand-off can't be "un-sent", so nothing
// is refunded. It is NOT a count of billed SMS segments (a long or Unicode
// message may be several parts). Reservations live in relayDevices/{id}.usage
// and are written in the SAME transaction that leases the job, so concurrent
// claims serialize on the device doc and can't oversubscribe. Client heartbeat
// telemetry never touches them.

export interface UsageWindow { s: number; c: number }
export interface RelayUsage { m?: UsageWindow; h?: UsageWindow; d?: { key: string; c: number } }
export interface CapsLike { maxPerMinute?: number; maxPerHour?: number; maxPerDay?: number }

const MINUTE_MS = 60_000;
const HOUR_MS_R = 3_600_000;

function winCount(w: UsageWindow | undefined, now: number, size: number): number {
  return w && typeof w.s === 'number' && now - w.s < size ? (w.c ?? 0) : 0;
}

/** Pure: may one more job be reserved for this device right now? */
export function relayCapacityCheck(
  caps: CapsLike | undefined, usage: RelayUsage | undefined, now: number,
): { ok: true } | { ok: false; window: 'minute' | 'hour' | 'day' } {
  const c = { ...DEFAULT_RELAY_CAPS_LOCAL, ...(caps ?? {}) };
  const u = usage ?? {};
  const day = utcDayKey(new Date(now));
  if (winCount(u.m, now, MINUTE_MS) >= c.maxPerMinute) return { ok: false, window: 'minute' };
  if (winCount(u.h, now, HOUR_MS_R) >= c.maxPerHour) return { ok: false, window: 'hour' };
  if ((u.d?.key === day ? u.d.c : 0) >= c.maxPerDay) return { ok: false, window: 'day' };
  return { ok: true };
}

/** Pure: usage after reserving one more job at `now` (UTC day rollover aware). */
export function reserveRelayUsage(usage: RelayUsage | undefined, now: number): RelayUsage {
  const u = usage ?? {};
  const bump = (w: UsageWindow | undefined, size: number): UsageWindow =>
    (w && typeof w.s === 'number' && now - w.s < size) ? { s: w.s, c: (w.c ?? 0) + 1 } : { s: now, c: 1 };
  const day = utcDayKey(new Date(now));
  return { m: bump(u.m, MINUTE_MS), h: bump(u.h, HOUR_MS_R), d: { key: day, c: (u.d?.key === day ? u.d.c : 0) + 1 } };
}

const DEFAULT_RELAY_CAPS_LOCAL = { maxPerMinute: 6, maxPerHour: 100, maxPerDay: 500 };

/** Clamp client-reported heartbeat telemetry (informational only). */
export function sanitizeTelemetryCount(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.min(1_000_000, Math.max(0, Math.floor(v)));
}

/** LEGACY helper kept for compatibility; the claim path uses relayCapacityCheck.
 *  Remaining daily send capacity from a counter. */
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

/** Outcome of a failed send report: requeue (retry) or terminal fail.
 *  Verification-code jobs (see isVerificationJobKind) NEVER requeue, whatever
 *  their stored maxAttempts says: a "failed"/timed-out report from a phone is
 *  ambiguous (the SMS may already have left the device), so an internal retry
 *  could text the same person twice. The user asks for a new code instead,
 *  which goes back through every abuse limit. */
export function failureOutcome(
  attempts: number, maxAttempts: number, cls: FailureClass, kind?: unknown,
): 'requeue' | 'fail' {
  if (isVerificationJobKind(kind)) return 'fail';
  if (cls === 'permanent') return 'fail';
  return attempts < maxAttempts ? 'requeue' : 'fail';
}

/** Reaper decision for a job whose lease may have lapsed. A lapsed lease is the
 *  classic ambiguous timeout (device took the job, then went silent), so
 *  verification-code jobs are failed, never requeued. */
export function reapDecision(
  job: { status: RelayJobStatus; leaseExpiresAtMs: number | null; attempts: number; maxAttempts: number; kind?: unknown },
  nowMs: number,
): 'none' | 'requeue' | 'fail' {
  if (job.status !== 'claimed' && job.status !== 'sending') return 'none';
  if (job.leaseExpiresAtMs == null || job.leaseExpiresAtMs > nowMs) return 'none';
  if (isVerificationJobKind(job.kind)) return 'fail';
  return job.attempts >= job.maxAttempts ? 'fail' : 'requeue';
}

// ── Verification-code jobs (sign-in OTP — retired; phone linking) ───────────
/** Legacy PUBLIC sign-in OTP jobs. Public phone sign-in is disabled; any such
 *  job still queued (e.g. from the abuse) must never be handed to a device. */
export const PUBLIC_OTP_JOB_KIND = 'otp';
/** Account phone-linking verification code (authenticated, rate-limited). */
export const PHONE_LINK_JOB_KIND = 'phone_link_otp';
/** Protected public phone sign-in / sign-up code (pre-auth session + proof). */
export const PHONE_AUTH_JOB_KIND = 'phone_auth_otp';

export function isVerificationJobKind(kind: unknown): boolean {
  return kind === PUBLIC_OTP_JOB_KIND || kind === PHONE_LINK_JOB_KIND || kind === PHONE_AUTH_JOB_KIND;
}

/** Purpose of a current-generation verification job (null for legacy/other). */
export function verificationPurposeOf(kind: unknown): 'signin' | 'link' | null {
  return kind === PHONE_AUTH_JOB_KIND ? 'signin' : kind === PHONE_LINK_JOB_KIND ? 'link' : null;
}

export type VerificationClaimDecision =
  | 'allow'
  | 'cancel-public-otp-disabled'
  | 'cancel-expired'
  | 'cancel-sending-stopped';

/**
 * May a device lease this job right now? Non-verification jobs are always
 * 'allow' here (their own gates apply). Verification jobs are cancelled —
 * never delivered — when they are legacy public OTPs, when the code has
 * expired (or carries no expiry at all), or when verification sending is
 * stopped (feature off / emergency stop / config unreadable). Pure.
 */
export function verificationClaimDecision(
  job: { kind: unknown; expiresAtMs: number | null | undefined },
  nowMs: number,
  phoneLinkSendingAllowed: boolean,
): VerificationClaimDecision {
  if (!isVerificationJobKind(job.kind)) return 'allow';
  if (job.kind === PUBLIC_OTP_JOB_KIND) return 'cancel-public-otp-disabled';
  if (job.expiresAtMs == null || job.expiresAtMs <= nowMs) return 'cancel-expired';
  if (!phoneLinkSendingAllowed) return 'cancel-sending-stopped';
  return 'allow';
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

// ── Country-based relay routing ─────────────────────────────────────────────

/** Validate/normalize a list of ISO alpha-2 country codes (uppercased, deduped,
 *  sorted; only codes libphonenumber recognizes are kept). */
export function normalizeCountryCodes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const c of input) {
    if (typeof c !== 'string') continue;
    const code = c.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code) && isSupportedCountry(code as any)) out.add(code);
  }
  return [...out].sort();
}

/** A relay is eligible for country routing only when explicitly enabled AND it
 *  has at least one allowed country. Missing/empty config (e.g. relays enrolled
 *  before this feature) means BLOCKED — never "all countries". */
export function isRelayConfiguredForRouting(
  d: { countryRoutingEnabled?: boolean | null; allowedCountryCodes?: string[] | null },
): boolean {
  return d.countryRoutingEnabled === true
    && Array.isArray(d.allowedCountryCodes)
    && d.allowedCountryCodes.length > 0;
}

/** Does this relay explicitly cover the given ISO alpha-2 country? */
export function deviceServesCountry(
  d: { allowedCountryCodes?: string[] | null },
  countryCode: string,
): boolean {
  return Array.isArray(d.allowedCountryCodes) && d.allowedCountryCodes.includes(countryCode);
}

/**
 * Claim-time safety check (defense-in-depth at the relay app boundary): may a
 * device whose served countries are `allowedCountryCodes` claim a job tagged
 * with `jobCountry`?
 *   • Country-tagged job (recipientCountryCode set) → only if the device serves
 *     that country. An unconfigured device (empty list) can claim NO tagged job.
 *   • Untagged job (no recipientCountryCode — e.g. legacy/sign-in OTP) → any
 *     device may claim it (those jobs are gated at creation, not at claim).
 * A device can therefore NEVER pull a job for a country it doesn't serve, even
 * if a job were created/mistagged incorrectly upstream.
 */
export function canDeviceClaimJobCountry(
  allowedCountryCodes: string[] | null | undefined,
  jobCountry: unknown,
): boolean {
  if (typeof jobCountry !== 'string' || jobCountry === '') return true; // untagged
  return Array.isArray(allowedCountryCodes) && allowedCountryCodes.includes(jobCountry);
}

export interface RouteDeviceCountry {
  deviceId: string;
  remaining: number;
  status: string;
  lastHeartbeatMs: number | null;
  countryRoutingEnabled?: boolean | null;
  allowedCountryCodes?: string[] | null;
}

/** Relays eligible to send to `countryCode`: active + heartbeat-fresh + has
 *  capacity + country routing configured + explicitly covers the country.
 *  No cross-country fallback, no "all countries" default. */
export function eligibleRelaysForCountry(
  devices: RouteDeviceCountry[], countryCode: string, nowMs: number,
): RouteDeviceCountry[] {
  return devices.filter(d =>
    isDeviceRoutable({ status: d.status, lastHeartbeatMs: d.lastHeartbeatMs, remaining: d.remaining }, nowMs)
    && isRelayConfiguredForRouting(d)
    && deviceServesCountry(d, countryCode),
  );
}

/** Coverage check (capacity-agnostic): is there a live, configured relay that
 *  serves this country? Used to decide eligibility/billing — capacity is a
 *  transient pacing limit handled by queueing, not a coverage gap. */
export function hasRelayCoverageForCountry(
  devices: RouteDeviceCountry[], countryCode: string, nowMs: number,
): boolean {
  return devices.some(d =>
    d.status === 'active'
    && !isHeartbeatStale(d.lastHeartbeatMs, nowMs)
    && isRelayConfiguredForRouting(d)
    && deviceServesCountry(d, countryCode));
}

/** Union of all ISO alpha-2 countries served by at least one live, configured
 *  relay (sorted, deduped). The set of countries a send/sign-in is possible to.
 *  Capacity-agnostic — an at-capacity country still counts as supported. */
export function supportedCountriesForDevices(
  devices: RouteDeviceCountry[], nowMs: number,
): string[] {
  const out = new Set<string>();
  for (const d of devices) {
    if (d.status !== 'active') continue;
    if (isHeartbeatStale(d.lastHeartbeatMs, nowMs)) continue;
    if (!isRelayConfiguredForRouting(d)) continue;
    for (const c of d.allowedCountryCodes ?? []) out.add(c);
  }
  return [...out].sort();
}

export type SkipReasonCode = 'invalid_phone' | 'unsupported_country' | 'no_relay_for_country';

/**
 * The single coverage decision applied to EVERY send (1:1, group, org, OTP,
 * admin test) regardless of provider mode (relay AND http). Given a recipient
 * whose phone has already been parsed, returns null when the message may be
 * sent, or the skip reason when it must NOT be:
 *   • invalid_phone       — number didn't parse
 *   • unsupported_country — parsed but no ISO country detected
 *   • no_relay_for_country — country detected but no live relay serves it
 * Capacity-agnostic: an at-capacity but otherwise-covered country is NOT a gap
 * (it queues), so this returns null for it.
 */
export function coverageSkipReason(
  devices: RouteDeviceCountry[],
  parsed: { valid: boolean; countryCode: string | null },
  nowMs: number,
): SkipReasonCode | null {
  if (!parsed.valid) return 'invalid_phone';
  if (!parsed.countryCode) return 'unsupported_country';
  return hasRelayCoverageForCountry(devices, parsed.countryCode, nowMs) ? null : 'no_relay_for_country';
}

export interface RecipientOutcome { countryCode: string | null; queued: boolean; reason?: string }

export interface DispatchSummary {
  totalRecipients: number;
  eligibleRecipients: number;
  skippedRecipients: number;
  skippedByReason: Record<string, number>;
  countries: Record<string, { eligible: number; skipped: number }>;
}

/** Build the send summary (per spec) from per-recipient outcomes. */
export function summarizeOutcomes(outcomes: RecipientOutcome[]): DispatchSummary {
  const s: DispatchSummary = {
    totalRecipients: outcomes.length, eligibleRecipients: 0, skippedRecipients: 0,
    skippedByReason: {}, countries: {},
  };
  for (const o of outcomes) {
    const cc = o.countryCode ?? 'unknown';
    s.countries[cc] ??= { eligible: 0, skipped: 0 };
    if (o.queued) { s.eligibleRecipients++; s.countries[cc].eligible++; }
    else {
      s.skippedRecipients++; s.countries[cc].skipped++;
      const r = o.reason ?? 'unknown';
      s.skippedByReason[r] = (s.skippedByReason[r] ?? 0) + 1;
    }
  }
  return s;
}

/** Pick the best eligible relay for a country. Priority: least-loaded (most
 *  remaining capacity) → most recent heartbeat → deterministic by deviceId. */
export function pickRelayForCountry(
  devices: RouteDeviceCountry[], countryCode: string, nowMs: number, excludeRelayIds: string[] = [],
): RouteDeviceCountry | null {
  const exclude = new Set(excludeRelayIds);
  const eligible = eligibleRelaysForCountry(devices, countryCode, nowMs).filter(d => !exclude.has(d.deviceId));
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    if (b.remaining !== a.remaining) return b.remaining - a.remaining;       // least-loaded
    const ah = a.lastHeartbeatMs ?? 0, bh = b.lastHeartbeatMs ?? 0;
    if (bh !== ah) return bh - ah;                                           // freshest heartbeat
    return a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0;   // deterministic
  });
  return eligible[0];
}

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
