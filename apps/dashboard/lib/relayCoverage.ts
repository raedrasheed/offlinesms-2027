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

/** Loads live country coverage for the native pool or the selected Business relay. */
export async function loadOrgRelayCoverage(
  organizationId: string,
  nowMs: number = Date.now(),
  options: { useAssignedRelay?: boolean } = {},
): Promise<{ has: (countryCode: string) => boolean; assignedRelayDeviceId: string | null }> {
  const devices = adminDb.collection("relayDevices");
  const assignment = options.useAssignedRelay
    ? await adminDb.collection("organizationRelayAssignments").doc(organizationId).get()
    : null;
  let assignedRelayDeviceId: string | null = null;
  let candidates: FirebaseFirestore.DocumentSnapshot[];
  if (assignment?.exists) {
    const id: unknown = assignment.get("relayDeviceId");
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      return { has: () => false, assignedRelayDeviceId: null };
    }
    assignedRelayDeviceId = id;
    const device = await devices.doc(id).get();
    const owner = device.get("businessId");
    candidates = device.exists && typeof owner === "string" && owner.trim() ? [device] : [];
  } else {
    const snap = await devices.where("businessId", "==", organizationId)
      .where("status", "==", "active").limit(50).get();
    candidates = snap.docs;
  }

  const relays: RelayLite[] = candidates.map(d => ({
    status: (d.get("status") as string) ?? "offline",
    lastHeartbeatMs: (d.get("lastHeartbeatAt") as { toMillis?: () => number } | null)?.toMillis?.() ?? null,
    countryRoutingEnabled: d.get("countryRoutingEnabled") === true,
    allowedCountryCodes: Array.isArray(d.get("allowedCountryCodes")) ? d.get("allowedCountryCodes") as string[] : [],
  }));

  const has = (countryCode: string): boolean => relays.some(r =>
    r.status === "active"
    && r.lastHeartbeatMs != null && (nowMs - r.lastHeartbeatMs) <= HEARTBEAT_STALE_MS
    && r.countryRoutingEnabled
    && r.allowedCountryCodes.length > 0
    && r.allowedCountryCodes.includes(countryCode));

  return { has, assignedRelayDeviceId };
}

export interface CoverageSummary { covered: number; noRelay: number; unknown: number }

export function summarizeCoverage(statuses: SmsCoverageStatus[]): CoverageSummary {
  return {
    covered: statuses.filter(s => s === "covered").length,
    noRelay: statuses.filter(s => s === "no_relay_for_country").length,
    unknown: statuses.filter(s => s === "unknown").length,
  };
}
