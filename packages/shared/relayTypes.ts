// Shared relay contracts (Phase 24 — OfflineSMS-Business relay).
//
// Mirrored intentionally (not imported by `functions`, which compiles only its
// own src — same convention as functions/src/lib/roles.ts). The dashboard and
// any TS tooling can import these; the Kotlin relay app has its own data classes.

export type RelayDeviceStatus = 'active' | 'paused' | 'offline' | 'revoked';

/** Country-based relay routing fields stored on relayDevices/{id}. */
export interface RelayCountryRouting {
  /** ISO alpha-2 codes this relay may send to. Empty = ineligible for sending. */
  allowedCountryCodes: string[];
  /** Master switch; false/missing excludes the relay from country routing. */
  countryRoutingEnabled: boolean;
}

export type RelayJobStatus =
  | 'queued'    // created, not yet assigned/claimed
  | 'claimed'   // leased by a device
  | 'sending'   // device is sending via SIM
  | 'sent'      // handed to the carrier
  | 'delivered' // carrier delivery report received
  | 'failed'    // permanent/transient failure (see lastError)
  | 'expired';  // lease lapsed without a terminal report

export interface RelaySimInfo {
  subscriptionId: number;
  slotIndex?: number | null;
  carrierName?: string | null;
}

export interface RelayCaps {
  maxPerMinute: number;
  maxPerHour: number;
  maxPerDay: number;
}

export interface RelayCounters {
  sentToday: number;
  failedToday: number;
  deliveredToday: number;
}

export type SmsProviderMode = 'http' | 'relay' | 'relay_with_http_fallback';

// ── Callable I/O contracts ────────────────────────────────────────────────
export interface CreateRelayPairingCodeInput { businessId?: string; label?: string }
export interface CreateRelayPairingCodeResult { code: string; expiresAt: number; businessId: string }

export interface EnrollRelayDeviceInput {
  pairingCode: string;
  deviceLabel: string;
  fcmToken: string;
  appVersion: string;
  androidInfo: { manufacturer?: string; model?: string; androidVersion?: string };
  simInfo: RelaySimInfo[];
}
export interface EnrollRelayDeviceResult { deviceId: string; businessId: string; customToken: string }

export interface ClaimRelayJobsInput { deviceId: string; capacity: number; simStatus?: RelaySimInfo[] }
export interface ClaimedRelayJob {
  jobId: string;
  phoneE164: string;
  messageBody: string;
  assignedSimSubscriptionId?: number | null;
  traceId: string;
}
export interface ClaimRelayJobsResult { jobs: ClaimedRelayJob[] }

export type RelayReportStatus = 'sent' | 'delivered' | 'failed';
export interface ReportRelayDeliveryInput {
  deviceId: string;
  jobId: string;
  status: RelayReportStatus;
  reason?: string;
  androidResultCode?: number;
  simSubscriptionId?: number;
  timestamp: string;
}

export interface RelayHeartbeatInput {
  deviceId: string;
  fcmToken?: string;
  appVersion?: string;
  simInfo?: RelaySimInfo[];
  queueDepth?: number;
  sentToday?: number;
  failedToday?: number;
  lastError?: string;
}

export const DEFAULT_RELAY_CAPS: RelayCaps = { maxPerMinute: 6, maxPerHour: 100, maxPerDay: 500 };
