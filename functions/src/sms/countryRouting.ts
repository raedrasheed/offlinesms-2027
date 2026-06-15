// Universal country-based relay resolver — the single backend service that EVERY
// OfflineSMS send flow (1:1, group, org dashboard, org API, admin/internal) must
// use before queueing. Enforcement lives here (and is re-checked in the
// dispatcher), never in the dashboard UI or the relay app.
//
//   "Is there an active healthy relay assigned to the recipient country?"
//   yes → route through it; no → do not send, return no_relay_for_country.

import { getFirestore } from 'firebase-admin/firestore';
import { normalizePhoneAndCountry } from '../lib/phoneCountry';
import { deviceRemaining, pickRelayForCountry, type RouteDeviceCountry } from './relayLogic';

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
  const db = getFirestore();
  const snap = await db.collection('relayDevices')
    .where('businessId', '==', params.businessId)
    .where('status', '==', 'active')
    .limit(50)
    .get();

  const devices: RouteDeviceCountry[] = snap.docs.map(d => {
    const caps = (d.get('caps') ?? { maxPerDay: 0 }) as { maxPerDay: number };
    const counters = (d.get('counters') ?? {}) as { sentToday?: number };
    return {
      deviceId: d.id,
      remaining: deviceRemaining(caps, counters),
      status: (d.get('status') as string) ?? 'offline',
      lastHeartbeatMs: (d.get('lastHeartbeatAt') as { toMillis?: () => number } | null)?.toMillis?.() ?? null,
      countryRoutingEnabled: d.get('countryRoutingEnabled') === true,
      allowedCountryCodes: (d.get('allowedCountryCodes') as string[] | undefined) ?? [],
    };
  });

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
