// Universal country-based relay resolver — the single backend service that EVERY
// OfflineSMS send flow (1:1, group, org dashboard, org API, admin/internal) must
// use before queueing. Enforcement lives here (and is re-checked in the
// dispatcher), never in the dashboard UI or the relay app.
//
//   "Is there an active healthy relay assigned to the recipient country?"
//   yes → route through it; no → do not send, return no_relay_for_country.

import { getFirestore } from 'firebase-admin/firestore';
import { normalizePhoneAndCountry } from '../lib/phoneCountry';
import {
  deviceRemaining, pickRelayForCountry, coverageSkipReason,
  type RouteDeviceCountry, type SkipReasonCode,
} from './relayLogic';

function routeDevice(snapshot: FirebaseFirestore.DocumentSnapshot): RouteDeviceCountry {
  const caps = (snapshot.get('caps') ?? { maxPerDay: 0 }) as { maxPerDay: number };
  const counters = (snapshot.get('counters') ?? {}) as { sentToday?: number };
  return {
    deviceId: snapshot.id,
    remaining: deviceRemaining(caps, counters),
    status: (snapshot.get('status') as string) ?? 'offline',
    lastHeartbeatMs: (snapshot.get('lastHeartbeatAt') as { toMillis?: () => number } | null)?.toMillis?.() ?? null,
    countryRoutingEnabled: snapshot.get('countryRoutingEnabled') === true,
    allowedCountryCodes: (snapshot.get('allowedCountryCodes') as string[] | undefined) ?? [],
  };
}

/** An explicit assignment is exclusive and is used only by organization messages. */
export async function loadOrganizationRelayAssignment(businessId: string): Promise<string | null> {
  const assignment = await getFirestore().collection('organizationRelayAssignments').doc(businessId).get();
  if (!assignment.exists) return null;
  const deviceId = assignment.get('relayDeviceId');
  if (typeof deviceId !== 'string' || !deviceId.trim() || deviceId.includes('/') || deviceId === '.' || deviceId === '..') {
    throw new Error('organization-relay-assignment-invalid');
  }
  return deviceId;
}

/** The normal pool is business-owned. Organization messaging may opt in to a
 *  selected device, which replaces that pool even when it is unavailable. */
export async function loadActiveRelayDevices(
  businessId: string,
  organizationRelayDeviceId?: string | null,
): Promise<RouteDeviceCountry[]> {
  const devices = getFirestore().collection('relayDevices');
  if (organizationRelayDeviceId) {
    const selected = await devices.doc(organizationRelayDeviceId).get();
    const owner = selected.get('businessId');
    if (!selected.exists || selected.get('status') !== 'active' || typeof owner !== 'string' || !owner) return [];
    return [routeDevice(selected)];
  }
  const snapshot = await devices.where('businessId', '==', businessId).where('status', '==', 'active').limit(50).get();
  return snapshot.docs.map(routeDevice);
}

export interface CoverageRecipient { id: string; phoneE164: string | null }
export interface CoveredRecipient { id: string; e164: string; countryCode: string }
export interface UncoveredRecipient { id: string; e164: string | null; countryCode: string | null; reason: SkipReasonCode }

/**
 * Partition recipients into covered (a live relay serves their country) and
 * uncovered (invalid phone / undetectable country / no relay for country). Used
 * by every send flow BEFORE reserving points so billing matches what's sent.
 * Capacity-agnostic: capacity overflow is queued, not a coverage gap.
 */
export async function partitionRecipientsByCoverage(
  businessId: string,
  recipients: CoverageRecipient[],
  opts: { defaultCountry?: string; nowMs?: number; organizationRelayDeviceId?: string | null } = {},
): Promise<{ covered: CoveredRecipient[]; uncovered: UncoveredRecipient[] }> {
  const nowMs = opts.nowMs ?? Date.now();
  const devices = await loadActiveRelayDevices(businessId, opts.organizationRelayDeviceId);
  const covered: CoveredRecipient[] = [];
  const uncovered: UncoveredRecipient[] = [];
  for (const r of recipients) {
    const norm = normalizePhoneAndCountry(r.phoneE164 ?? '', opts.defaultCountry);
    const reason = coverageSkipReason(devices, { valid: norm.isValid && !!norm.e164, countryCode: norm.countryCode }, nowMs);
    if (reason === null) {
      // coverageSkipReason returns null only when valid + countryCode + covered.
      covered.push({ id: r.id, e164: norm.e164 as string, countryCode: norm.countryCode as string });
    } else {
      uncovered.push({ id: r.id, e164: norm.e164 || null, countryCode: norm.countryCode ?? null, reason });
    }
  }
  return { covered, uncovered };
}

/** User-facing message for an uncovered country (AR + EN per spec). */
export const NO_RELAY_FOR_COUNTRY = {
  ar: 'لا يوجد relay لهذه البلد',
  en: 'No relay is available for this country',
} as const;

export type ResolveErrorCode = 'invalid_phone' | 'unsupported_country' | 'no_relay_for_country';

export interface FindEligibleRelayParams {
  /** Relays are org-scoped by businessId (= organizationId). */
  businessId: string;
  countryCode: string;
  excludeRelayIds?: string[];
  nowMs?: number;
}

/** Query the business's relays and pick the best one that covers the country
 *  (active + fresh + routing-enabled + country-allowed + has capacity). */
export async function findEligibleRelayForCountry(
  params: FindEligibleRelayParams,
): Promise<RouteDeviceCountry | null> {
  const nowMs = params.nowMs ?? Date.now();
  const devices = await loadActiveRelayDevices(params.businessId);
  return pickRelayForCountry(devices, params.countryCode, nowMs, params.excludeRelayIds);
}

export interface ResolveRelayParams {
  senderType: 'user' | 'organization' | 'admin';
  senderId: string;
  /** The business whose relays may be used. Required to find a relay. */
  organizationId?: string;
  recipientPhone: string;
  /** Optional ISO alpha-2 to interpret national-format input. */
  defaultCountry?: string;
  excludeRelayIds?: string[];
  nowMs?: number;
}

export interface ResolveRelayResult {
  ok: boolean;
  relayId?: string;
  recipientPhoneE164?: string;
  recipientCountryCode?: string;
  errorCode?: ResolveErrorCode;
  userMessage?: string;
}

/**
 * Resolve the relay for one recipient. ok:true ⇒ an eligible relay that
 * explicitly covers the recipient's country was found. ok:false ⇒ do not create
 * any SMS/relay job; surface errorCode + userMessage. No flow may bypass this.
 */
export async function resolveRelayForOfflineSmsRecipient(
  params: ResolveRelayParams,
): Promise<ResolveRelayResult> {
  const norm = normalizePhoneAndCountry(params.recipientPhone, params.defaultCountry);
  if (!norm.isValid || !norm.e164) {
    return { ok: false, errorCode: 'invalid_phone', userMessage: 'Invalid phone number' };
  }
  if (!norm.countryCode) {
    return {
      ok: false, recipientPhoneE164: norm.e164,
      errorCode: 'unsupported_country', userMessage: NO_RELAY_FOR_COUNTRY.en,
    };
  }
  if (!params.organizationId) {
    // No business context ⇒ no relays to search ⇒ treat as uncovered.
    return {
      ok: false, recipientPhoneE164: norm.e164, recipientCountryCode: norm.countryCode,
      errorCode: 'no_relay_for_country', userMessage: NO_RELAY_FOR_COUNTRY.en,
    };
  }

  const relay = await findEligibleRelayForCountry({
    businessId: params.organizationId,
    countryCode: norm.countryCode,
    excludeRelayIds: params.excludeRelayIds,
    nowMs: params.nowMs,
  });
  if (!relay) {
    return {
      ok: false, recipientPhoneE164: norm.e164, recipientCountryCode: norm.countryCode,
      errorCode: 'no_relay_for_country', userMessage: NO_RELAY_FOR_COUNTRY.en,
    };
  }

  return {
    ok: true, relayId: relay.deviceId,
    recipientPhoneE164: norm.e164, recipientCountryCode: norm.countryCode,
  };
}
