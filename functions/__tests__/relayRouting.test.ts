import { describe, it, expect } from 'vitest';
import {
  eligibleRelaysForCountry, pickRelayForCountry, HEARTBEAT_STALE_MS,
  type RouteDeviceCountry,
} from '../src/sms/relayLogic';

const NOW = 1_000_000_000;
const fresh = NOW - 1_000;               // within heartbeat threshold
const stale = NOW - HEARTBEAT_STALE_MS - 1;

function dev(p: Partial<RouteDeviceCountry> & { deviceId: string }): RouteDeviceCountry {
  return {
    remaining: 100, status: 'active', lastHeartbeatMs: fresh,
    countryRoutingEnabled: true, allowedCountryCodes: ['PS'],
    ...p,
  };
}

describe('eligibleRelaysForCountry — exclusions', () => {
  it('includes a relay that serves the country', () => {
    const out = eligibleRelaysForCountry([dev({ deviceId: 'a' })], 'PS', NOW);
    expect(out.map(d => d.deviceId)).toEqual(['a']);
  });
  it('excludes a relay that does not serve the country (no cross-country fallback)', () => {
    const out = eligibleRelaysForCountry([dev({ deviceId: 'a', allowedCountryCodes: ['JO'] })], 'PS', NOW);
    expect(out).toEqual([]);
  });
  it('excludes a relay with empty allowedCountryCodes', () => {
    const out = eligibleRelaysForCountry([dev({ deviceId: 'a', allowedCountryCodes: [] })], 'PS', NOW);
    expect(out).toEqual([]);
  });
  it('excludes a relay with countryRoutingEnabled=false (legacy/unconfigured)', () => {
    const out = eligibleRelaysForCountry([dev({ deviceId: 'a', countryRoutingEnabled: false })], 'PS', NOW);
    expect(out).toEqual([]);
  });
  it('excludes a revoked relay', () => {
    const out = eligibleRelaysForCountry([dev({ deviceId: 'a', status: 'revoked' })], 'PS', NOW);
    expect(out).toEqual([]);
  });
  it('excludes an offline / paused relay', () => {
    expect(eligibleRelaysForCountry([dev({ deviceId: 'a', status: 'offline' })], 'PS', NOW)).toEqual([]);
    expect(eligibleRelaysForCountry([dev({ deviceId: 'a', status: 'paused' })], 'PS', NOW)).toEqual([]);
  });
  it('excludes a relay with a stale heartbeat', () => {
    const out = eligibleRelaysForCountry([dev({ deviceId: 'a', lastHeartbeatMs: stale })], 'PS', NOW);
    expect(out).toEqual([]);
  });
  it('excludes a relay with no remaining capacity', () => {
    const out = eligibleRelaysForCountry([dev({ deviceId: 'a', remaining: 0 })], 'PS', NOW);
    expect(out).toEqual([]);
  });
});

describe('pickRelayForCountry — selection priority', () => {
  it('returns null when nothing is eligible', () => {
    expect(pickRelayForCountry([dev({ deviceId: 'a', allowedCountryCodes: ['JO'] })], 'PS', NOW)).toBeNull();
  });
  it('prefers the least-loaded relay (most remaining capacity)', () => {
    const picked = pickRelayForCountry([
      dev({ deviceId: 'a', remaining: 10 }),
      dev({ deviceId: 'b', remaining: 90 }),
      dev({ deviceId: 'c', remaining: 50 }),
    ], 'PS', NOW);
    expect(picked?.deviceId).toBe('b');
  });
  it('breaks capacity ties by most recent heartbeat', () => {
    const picked = pickRelayForCountry([
      dev({ deviceId: 'a', remaining: 50, lastHeartbeatMs: NOW - 5000 }),
      dev({ deviceId: 'b', remaining: 50, lastHeartbeatMs: NOW - 100 }),
    ], 'PS', NOW);
    expect(picked?.deviceId).toBe('b');
  });
  it('breaks remaining ties deterministically by deviceId', () => {
    const picked = pickRelayForCountry([
      dev({ deviceId: 'z', remaining: 50, lastHeartbeatMs: fresh }),
      dev({ deviceId: 'a', remaining: 50, lastHeartbeatMs: fresh }),
    ], 'PS', NOW);
    expect(picked?.deviceId).toBe('a');
  });
  it('honors excludeRelayIds', () => {
    const picked = pickRelayForCountry([
      dev({ deviceId: 'a', remaining: 90 }),
      dev({ deviceId: 'b', remaining: 50 }),
    ], 'PS', NOW, ['a']);
    expect(picked?.deviceId).toBe('b');
  });
  it('routes each country to its own relay (mixed fleet)', () => {
    const fleet = [
      dev({ deviceId: 'ps1', allowedCountryCodes: ['PS', 'IL'] }),
      dev({ deviceId: 'jo1', allowedCountryCodes: ['JO'] }),
    ];
    expect(pickRelayForCountry(fleet, 'PS', NOW)?.deviceId).toBe('ps1');
    expect(pickRelayForCountry(fleet, 'IL', NOW)?.deviceId).toBe('ps1');
    expect(pickRelayForCountry(fleet, 'JO', NOW)?.deviceId).toBe('jo1');
    expect(pickRelayForCountry(fleet, 'EG', NOW)).toBeNull(); // no coverage
  });
});
