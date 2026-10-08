// Phone-linking configuration: feature gate, emergency stop, abuse thresholds.
//
// Two independent switches must BOTH be on before a single verification SMS can
// be queued, and either one can stop it:
//
//   1. Deploy-time env var  PHONE_LINK_ENABLED=true   (default: off)
//      Lives in functions/.env.<project> — changing it needs a deploy, so it
//      is the "rollout explicitly authorized" switch.
//   2. Runtime Firestore doc smsConfig/phoneLink      (admin-only via rules)
//        { enabled: true, emergencyStop: false, businessId: '<relay org>',
//          androidAppHash?: '<11 chars>', limits?: { ...overrides } }
//      Flipping `emergencyStop: true` (or `enabled: false`) takes effect on the
//      next request with no deploy. Missing doc ⇒ disabled. Unreadable doc ⇒
//      the caller gets `service-paused` (fail closed).
//
// Limits are clamped to hard bounds so a typo in the runtime doc cannot remove
// a control (a limit can be tightened to 0 but never raised above its ceiling).

import type { Firestore } from 'firebase-admin/firestore';

export const PHONE_LINK_CONFIG_DOC = { collection: 'smsConfig', doc: 'phoneLink' } as const;

export interface PhoneLinkLimits {
  /** Lifetime of a verification code. */
  codeTtlSec: number;
  /** Wrong codes allowed per challenge before it is burned. */
  maxVerifyAttempts: number;
  /** Wrong codes allowed per account per day across all challenges. */
  accountVerifyFailuresPerDay: number;
  /** Min gap between two codes requested by the same account. */
  accountCooldownSec: number;
  accountPerHour: number;
  accountPerDay: number;
  /** Distinct destination numbers one account may try (rolling windows). */
  accountDistinctNumbersPerDay: number;
  accountDistinctNumbersPer30Days: number;
  /** Min gap between two codes sent to the same number (any account). */
  destinationCooldownSec: number;
  destinationPerHour: number;
  destinationPerDay: number;
  /** Per request-source bucket (IPv4 /32, IPv6 /64). Deliberately looser —
   *  carrier-grade NAT puts many real users behind one address. */
  sourcePerHour: number;
  sourcePerDay: number;
  /** Global sending budget for ALL phone-link SMS. */
  globalPerHour: number;
  globalPerDay: number;
  /** How recent the caller's sign-in must be (seconds since auth_time). */
  reauthMaxAgeSec: number;
}

/** Defaults — see docs/PHONE_LINKING_SECURITY.md §Thresholds for rationale. */
export const DEFAULT_LIMITS: PhoneLinkLimits = {
  codeTtlSec: 300,
  maxVerifyAttempts: 5,
  accountVerifyFailuresPerDay: 10,
  accountCooldownSec: 60,
  accountPerHour: 3,
  accountPerDay: 5,
  accountDistinctNumbersPerDay: 2,
  accountDistinctNumbersPer30Days: 3,
  destinationCooldownSec: 60,
  destinationPerHour: 3,
  destinationPerDay: 5,
  sourcePerHour: 20,
  sourcePerDay: 60,
  globalPerHour: 100,
  globalPerDay: 500,
  reauthMaxAgeSec: 600,
};

/** [min, max] for every limit. Runtime overrides are clamped into this range. */
export const LIMIT_BOUNDS: Record<keyof PhoneLinkLimits, [number, number]> = {
  codeTtlSec: [60, 600],
  maxVerifyAttempts: [1, 10],
  accountVerifyFailuresPerDay: [1, 30],
  accountCooldownSec: [30, 3600],
  accountPerHour: [0, 10],
  accountPerDay: [0, 20],
  accountDistinctNumbersPerDay: [0, 5],
  accountDistinctNumbersPer30Days: [0, 10],
  destinationCooldownSec: [30, 3600],
  destinationPerHour: [0, 10],
  destinationPerDay: [0, 20],
  sourcePerHour: [0, 200],
  sourcePerDay: [0, 1000],
  globalPerHour: [0, 2000],
  globalPerDay: [0, 10000],
  reauthMaxAgeSec: [60, 1800],
};

export interface PhoneLinkConfig {
  /** Env gate AND doc gate both on. */
  enabled: boolean;
  /** Runtime kill switch (or doc missing/unreadable). */
  emergencyStop: boolean;
  /** Relay organization that sends the codes. */
  businessId: string | null;
  androidAppHash: string | null;
  limits: PhoneLinkLimits;
  /** Which X-Forwarded-For entry (counted from the right) is the client. */
  sourceHopsFromRight: number;
  /** Consent text version the client must echo back. */
  consentVersion: string;
}

export const CONSENT_VERSION = 'phone-link-v1';

/** The env gate. Anything but the exact string "true" is off. */
export function phoneLinkEnvEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PHONE_LINK_ENABLED === 'true';
}

function clampInt(v: unknown, [lo, hi]: [number, number], fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.floor(v)));
}

/** Pure: merge runtime overrides onto defaults, clamping each into bounds. */
export function resolveLimits(overrides: unknown): PhoneLinkLimits {
  const o = (overrides && typeof overrides === 'object' ? overrides : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_LIMITS };
  for (const k of Object.keys(DEFAULT_LIMITS) as Array<keyof PhoneLinkLimits>) {
    out[k] = clampInt(o[k], LIMIT_BOUNDS[k], DEFAULT_LIMITS[k]);
  }
  return out;
}

/** Pure: build the effective config from the env gate + the raw doc (or null). */
export function resolvePhoneLinkConfig(
  envEnabled: boolean,
  doc: Record<string, unknown> | null,
): PhoneLinkConfig {
  const d = doc ?? {};
  const businessId = typeof d.businessId === 'string' && d.businessId.trim() ? d.businessId.trim() : null;
  const hash = typeof d.androidAppHash === 'string' && /^[A-Za-z0-9+/]{11}$/.test(d.androidAppHash.trim())
    ? d.androidAppHash.trim() : null;
  const hops = clampInt(d.sourceHopsFromRight, [1, 3], 1);
  return {
    enabled: envEnabled && doc !== null && d.enabled === true,
    // Missing doc, or anything other than an explicit `false`, is a stop.
    emergencyStop: doc === null || d.emergencyStop !== false,
    businessId,
    androidAppHash: hash,
    limits: resolveLimits(d.limits),
    sourceHopsFromRight: hops,
    consentVersion: CONSENT_VERSION,
  };
}

/** True when verification codes may be queued AND handed to a device. */
export function phoneLinkSendingAllowed(cfg: PhoneLinkConfig): boolean {
  return cfg.enabled && !cfg.emergencyStop && cfg.businessId !== null;
}

/**
 * Load the effective config. Throws when the doc cannot be read so callers can
 * fail closed; a missing doc is not an error (it simply means "off").
 */
export async function loadPhoneLinkConfig(db: Firestore): Promise<PhoneLinkConfig> {
  const snap = await db.collection(PHONE_LINK_CONFIG_DOC.collection).doc(PHONE_LINK_CONFIG_DOC.doc).get();
  return resolvePhoneLinkConfig(phoneLinkEnvEnabled(), snap.exists ? (snap.data() ?? {}) : null);
}
