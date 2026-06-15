// Backend relay types (Phase 24). Mirrors packages/shared/relayTypes.ts; kept
// local because the functions bundle compiles only its own src.

export type RelayDeviceStatus = 'active' | 'paused' | 'offline' | 'revoked';

export interface RelayCaps {
  maxPerMinute: number;
  maxPerHour: number;
  maxPerDay: number;
}

export const DEFAULT_RELAY_CAPS: RelayCaps = { maxPerMinute: 6, maxPerHour: 100, maxPerDay: 500 };

/** Country-based relay routing fields stored on relayDevices/{id}. */
export interface RelayCountryRouting {
  /** ISO alpha-2 codes this relay may send to. Empty = ineligible for sending. */
  allowedCountryCodes: string[];
  /** Master switch; false/missing excludes the relay from country routing. */
  countryRoutingEnabled: boolean;
}
