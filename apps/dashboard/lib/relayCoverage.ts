// Dashboard-side relay country coverage (org messaging API does the country
// check synchronously, in its own runtime). Mirrors the pure logic in
// functions/src/sms/relayLogic.ts (hasRelayCoverageForCountry) — capacity-
// agnostic: a country is "covered" if a live, configured relay serves it.

import { adminDb } from "./firebase-admin";

const HEARTBEAT_STALE_MS = 90 * 1000; // keep in sync with relayLogic.ts

export type SmsCoverageStatus = "covered" | "no_relay_for_country" | "unknown";

interface RelayLite {
  status: string;
  lastHeartbeatMs: number | null;
  countryRoutingEnabled: boolean;
  allowedCountryCodes: string[];
}

/** Loads an org's active relays once and returns a country-coverage checker. */
export async function loadOrgRelayCoverage(
  organizationId: string,
  nowMs: number = Date.now(),
): Promise<{ has: (countryCode: string) => boolean }> {
  const snap = await adminDb.collection("relayDevices")
    .where("businessId", "==", organizationId)
    .where("status", "==", "active")
    .limit(50)
    .get();

  const relays: RelayLite[] = snap.docs.map(d => ({
    status: (d.get("status") as string) ?? "offline",
    lastHeartbeatMs: (d.get("lastHeartbeatAt") as { toMillis?: () => number } | null)?.toMillis?.() ?? null,
    countryRoutingEnabled: d.get("countryRoutingEnabled") === true,
    allowedCountryCodes: (d.get("allowedCountryCodes") as string[] | undefined) ?? [],
  }));

  const has = (countryCode: string): boolean => relays.some(r =>
    r.status === "active"
    && r.lastHeartbeatMs != null && (nowMs - r.lastHeartbeatMs) <= HEARTBEAT_STALE_MS
    && r.countryRoutingEnabled
    && r.allowedCountryCodes.length > 0
    && r.allowedCountryCodes.includes(countryCode));

  return { has };
}

export interface CoverageSummary { covered: number; noRelay: number; unknown: number }

export function summarizeCoverage(statuses: SmsCoverageStatus[]): CoverageSummary {
  return {
    covered: statuses.filter(s => s === "covered").length,
    noRelay: statuses.filter(s => s === "no_relay_for_country").length,
    unknown: statuses.filter(s => s === "unknown").length,
  };
}
