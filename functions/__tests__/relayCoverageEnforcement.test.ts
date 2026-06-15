// Reproduction + regression tests for the country-relay enforcement bug:
// "OfflineSMS still sends to recipients in countries the relay doesn't cover."
//
// These exercise the single coverage decision (coverageSkipReason) that EVERY
// send path now applies — 1:1, group, org dashboard, org API, OTP, admin test —
// regardless of provider mode (relay AND http). The bug was that the decision
// was skipped for HTTP sends and for org in-app delivery; the fix makes it
// unconditional, so a PS-only relay can never produce a send to +972 (IL) or
// +962 (JO).

import { describe, it, expect } from 'vitest';
import { normalizePhoneAndCountry } from '../src/lib/phoneCountry';
import {
  coverageSkipReason, summarizeOutcomes, HEARTBEAT_STALE_MS,
  type RouteDeviceCountry,
} from '../src/sms/relayLogic';

const NOW = 1_000_000_000;

/** A single live relay configured for Palestine only. */
const PS_ONLY: RouteDeviceCountry[] = [{
  deviceId: 'relay-ps', remaining: 100, status: 'active', lastHeartbeatMs: NOW - 1_000,
  countryRoutingEnabled: true, allowedCountryCodes: ['PS'],
}];

/** Mirror of the per-flow filter: parse → decide coverage → keep only sendable.
 *  This is the exact composition escalate.ts / escalateOrgBatches.ts apply. */
function filterSendable(
  devices: RouteDeviceCountry[],
  recipients: Array<{ id: string; phone: string }>,
  nowMs = NOW,
) {
  const sendable: Array<{ id: string; countryCode: string }> = [];
  const outcomes = recipients.map(r => {
    const norm = normalizePhoneAndCountry(r.phone);
    const reason = coverageSkipReason(
      devices, { valid: norm.isValid && !!norm.e164, countryCode: norm.countryCode }, nowMs,
    );
    if (reason === null) {
      sendable.push({ id: r.id, countryCode: norm.countryCode as string });
      return { countryCode: norm.countryCode, queued: true };
    }
    return { countryCode: norm.countryCode, queued: false, reason };
  });
  return { sendable, summary: summarizeOutcomes(outcomes) };
}

describe('coverageSkipReason — the one decision every send applies', () => {
  it('PS-only relay covers PS', () => {
    expect(coverageSkipReason(PS_ONLY, { valid: true, countryCode: 'PS' }, NOW)).toBeNull();
  });
  it('PS-only relay does NOT cover IL or JO (the reported bug)', () => {
    expect(coverageSkipReason(PS_ONLY, { valid: true, countryCode: 'IL' }, NOW)).toBe('no_relay_for_country');
    expect(coverageSkipReason(PS_ONLY, { valid: true, countryCode: 'JO' }, NOW)).toBe('no_relay_for_country');
  });
  it('invalid / undetectable numbers are skipped with their own reason', () => {
    expect(coverageSkipReason(PS_ONLY, { valid: false, countryCode: null }, NOW)).toBe('invalid_phone');
    expect(coverageSkipReason(PS_ONLY, { valid: true, countryCode: null }, NOW)).toBe('unsupported_country');
  });
  it('a covered country at zero capacity still counts as covered (queues, not skipped)', () => {
    const atCap = [{ ...PS_ONLY[0], remaining: 0 }];
    expect(coverageSkipReason(atCap, { valid: true, countryCode: 'PS' }, NOW)).toBeNull();
  });
  it('no relay at all ⇒ every country is uncovered', () => {
    expect(coverageSkipReason([], { valid: true, countryCode: 'PS' }, NOW)).toBe('no_relay_for_country');
  });
  it('stale / paused / unconfigured relays provide no coverage', () => {
    const stale = [{ ...PS_ONLY[0], lastHeartbeatMs: NOW - HEARTBEAT_STALE_MS - 1 }];
    const paused = [{ ...PS_ONLY[0], status: 'paused' }];
    const unconfigured = [{ ...PS_ONLY[0], countryRoutingEnabled: false }];
    const noCountries = [{ ...PS_ONLY[0], allowedCountryCodes: [] }];
    for (const devs of [stale, paused, unconfigured, noCountries]) {
      expect(coverageSkipReason(devs, { valid: true, countryCode: 'PS' }, NOW)).toBe('no_relay_for_country');
    }
  });
});

describe('1:1 send — PS-only relay', () => {
  it('sends to a +970 (PS) recipient', () => {
    const { sendable } = filterSendable(PS_ONLY, [{ id: 'u1', phone: '+970599123456' }]);
    expect(sendable.map(s => s.id)).toEqual(['u1']);
  });
  it('does NOT send to a +972 (IL) recipient', () => {
    const { sendable, summary } = filterSendable(PS_ONLY, [{ id: 'u1', phone: '+972501234567' }]);
    expect(sendable).toEqual([]);
    expect(summary.skippedByReason.no_relay_for_country).toBe(1);
  });
  it('does NOT send to a +962 (JO) recipient', () => {
    const { sendable } = filterSendable(PS_ONLY, [{ id: 'u1', phone: '+962790123456' }]);
    expect(sendable).toEqual([]);
  });
});

describe('group send — PS-only relay, mixed-country audience', () => {
  it('queues only PS recipients and skips IL/JO with a correct summary', () => {
    const { sendable, summary } = filterSendable(PS_ONLY, [
      { id: 'ps1', phone: '+970599123456' },
      { id: 'ps2', phone: '+970598000111' },
      { id: 'il1', phone: '+972501234567' },
      { id: 'jo1', phone: '+962790123456' },
      { id: 'bad', phone: 'not-a-phone' },
    ]);
    expect(sendable.map(s => s.id).sort()).toEqual(['ps1', 'ps2']);
    expect(summary.totalRecipients).toBe(5);
    expect(summary.eligibleRecipients).toBe(2);
    expect(summary.skippedRecipients).toBe(3);
    expect(summary.skippedByReason).toEqual({ no_relay_for_country: 2, invalid_phone: 1 });
    expect(summary.countries.PS).toEqual({ eligible: 2, skipped: 0 });
    expect(summary.countries.IL).toEqual({ eligible: 0, skipped: 1 });
    expect(summary.countries.JO).toEqual({ eligible: 0, skipped: 1 });
  });

  it('a group with no covered recipient sends to nobody', () => {
    const { sendable } = filterSendable(PS_ONLY, [
      { id: 'il1', phone: '+972501234567' },
      { id: 'jo1', phone: '+962790123456' },
    ]);
    expect(sendable).toEqual([]);
  });
});

describe('multi-country relay coverage', () => {
  it('a relay covering PS+JO sends to both but not IL', () => {
    const psJo: RouteDeviceCountry[] = [{ ...PS_ONLY[0], allowedCountryCodes: ['PS', 'JO'] }];
    const { sendable } = filterSendable(psJo, [
      { id: 'ps1', phone: '+970599123456' },
      { id: 'jo1', phone: '+962790123456' },
      { id: 'il1', phone: '+972501234567' },
    ]);
    expect(sendable.map(s => s.id).sort()).toEqual(['jo1', 'ps1']);
  });
});
