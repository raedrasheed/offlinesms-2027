// Phone-linking configuration — the `link` purpose of the shared verification
// policy (smsConfig/otp; see functions/src/verification/policy.ts).
//
// Sending link codes requires ALL of: deploy-time env PHONE_LINK_ENABLED=true,
// policy `enabled: true`, `emergencyStop: false` (explicit), a sender
// `businessId`, and `link.enabled: true`. Any one of them stops new codes, and
// the relay refuses queued/claimed link codes whose businessId/policyVersion no
// longer match. Missing doc ⇒ off; unreadable doc ⇒ callers fail closed.
//
// Limits (`link.limits`) are clamped to hard bounds so a typo in the runtime doc
// cannot remove a control (a limit can be tightened to 0 but never raised above
// its ceiling).

import type { Firestore } from 'firebase-admin/firestore';
import {
  loadPolicyDoc, resolveShared, purposeSection, purposeEnvEnabled, clampInt, resolveBounded,
} from '../verification/policy';

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
  /** Env gate AND policy master AND `link.enabled`. */
  enabled: boolean;
  /** Runtime kill switch (or doc missing/unreadable). */
  emergencyStop: boolean;
  /** Relay organization that sends the codes. */
  businessId: string | null;
  androidAppHash: string | null;
  /** Policy generation recorded on every job (see verification/policy.ts). */
  policyVersion: number;
  limits: PhoneLinkLimits;
  /** Which X-Forwarded-For entry (counted from the right) is the client. */
  sourceHopsFromRight: number;
  /** Budget shared with public phone sign-in. */
  sharedPerHour: number;
  sharedPerDay: number;
  /** Consent text version the client must echo back. */
  consentVersion: string;
}

export const CONSENT_VERSION = 'phone-link-v1';

/** The env gate. Anything but the exact string "true" is off. */
export function phoneLinkEnvEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return purposeEnvEnabled('link', env);
}

/** Pure: merge runtime overrides onto defaults, clamping each into bounds. */
export function resolveLimits(overrides: unknown): PhoneLinkLimits {
  return resolveBounded(DEFAULT_LIMITS, LIMIT_BOUNDS, overrides);
}

/** Pure: build the effective config from the env gate + the raw policy doc (or null). */
export function resolvePhoneLinkConfig(
  envEnabled: boolean,
  doc: Record<string, unknown> | null,
): PhoneLinkConfig {
  const shared = resolveShared(doc);
  const link = purposeSection(doc, 'link');
  return {
    enabled: envEnabled && shared.masterEnabled && link.enabled === true,
    emergencyStop: shared.emergencyStop,
    businessId: shared.businessId,
    androidAppHash: shared.androidAppHash,
    policyVersion: shared.policyVersion,
    limits: resolveLimits(link.limits),
    sourceHopsFromRight: shared.sourceHopsFromRight,
    sharedPerHour: shared.sharedPerHour,
    sharedPerDay: shared.sharedPerDay,
    consentVersion: CONSENT_VERSION,
  };
}

/** True when link codes may be queued AND handed to a device. */
export function phoneLinkSendingAllowed(cfg: PhoneLinkConfig): boolean {
  return cfg.enabled && !cfg.emergencyStop && cfg.businessId !== null;
}

/**
 * Load the effective config. Throws when the doc cannot be read so callers can
 * fail closed; a missing doc is not an error (it simply means "off").
 */
export async function loadPhoneLinkConfig(db: Firestore): Promise<PhoneLinkConfig> {
  return resolvePhoneLinkConfig(phoneLinkEnvEnabled(), await loadPolicyDoc(db));
}

export { clampInt };
