import { describe, it, expect } from 'vitest';
import {
  summarizeOutcomes, hasRelayCoverageForCountry, HEARTBEAT_STALE_MS,
  type RecipientOutcome, type RouteDeviceCountry,
} from '../src/sms/relayLogic';

describe('summarizeOutcomes — group send summary (per spec shape)', () => {
  it('counts eligible/skipped per country + skippedByReason', () => {
    const outcomes: RecipientOutcome[] = [
      ...Array(10).fill(0).map(() => ({ countryCode: 'PS', queued: true })),
      ...Array(6).fill(0).map(() => ({ countryCode: 'IL', queued: true })),
      ...Array(3).fill(0).map(() => ({ countryCode: 'JO', queued: false, reason: 'no_relay_for_country' })),
      { countryCode: null, queued: false, reason: 'invalid_phone' },
    ];
    const s = summarizeOutcomes(outcomes);
    expect(s.totalRecipients).toBe(20);
    expect(s.eligibleRecipients).toBe(16);
    expect(s.skippedRecipients).toBe(4);
    expect(s.skippedByReason).toEqual({ no_relay_for_country: 3, invalid_phone: 1 });
    expect(s.countries.PS).toEqual({ eligible: 10, skipped: 0 });
    expect(s.countries.IL).toEqual({ eligible: 6, skipped: 0 });
    expect(s.countries.JO).toEqual({ eligible: 0, skipped: 3 });
  });

  it('handles an all-skipped batch', () => {
    const s = summarizeOutcomes([
      { countryCode: 'JO', queued: false, reason: 'no_relay_for_country' },
      { countryCode: 'JO', queued: false, reason: 'no_relay_for_country' },
    ]);
    expect(s.eligibleRecipients).toBe(0);
    expect(s.skippedRecipients).toBe(2);
    expect(s.skippedByReason.no_relay_for_country).toBe(2);
  });
});

describe('hasRelayCoverageForCountry — capacity-agnostic coverage', () => {
  const NOW = 1_000_000_000;
  const base: RouteDeviceCountry = {
    deviceId: 'd', remaining: 100, status: 'active', lastHeartbeatMs: NOW - 1000,
    countryRoutingEnabled: true, allowedCountryCodes: ['PS'],
  };
  it('covered when a live configured relay serves the country, even at 0 capacity', () => {
    expect(hasRelayCoverageForCountry([{ ...base, remaining: 0 }], 'PS', NOW)).toBe(true);
  });
  it('not covered when no relay serves the country', () => {
    expect(hasRelayCoverageForCountry([{ ...base, allowedCountryCodes: ['IL'] }], 'PS', NOW)).toBe(false);
  });
  it('not covered by a stale / offline / unconfigured relay', () => {
    expect(hasRelayCoverageForCountry([{ ...base, lastHeartbeatMs: NOW - HEARTBEAT_STALE_MS - 1 }], 'PS', NOW)).toBe(false);
    expect(hasRelayCoverageForCountry([{ ...base, status: 'offline' }], 'PS', NOW)).toBe(false);
    expect(hasRelayCoverageForCountry([{ ...base, countryRoutingEnabled: false }], 'PS', NOW)).toBe(false);
  });
});
