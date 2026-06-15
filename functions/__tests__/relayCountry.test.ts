import { describe, it, expect } from 'vitest';
import {
  normalizeCountryCodes, isRelayConfiguredForRouting, deviceServesCountry,
  canDeviceClaimJobCountry,
} from '../src/sms/relayLogic';

describe('normalizeCountryCodes', () => {
  it('uppercases, dedupes, sorts, and keeps only valid ISO alpha-2', () => {
    expect(normalizeCountryCodes(['ps', 'IL', 'jo', 'ps'])).toEqual(['IL', 'JO', 'PS']);
  });
  it('drops invalid / non-ISO entries', () => {
    expect(normalizeCountryCodes(['PS', 'ZZ', 'XX', 'usa', '1', '', 12])).toEqual(['PS']);
  });
  it('returns [] for non-arrays', () => {
    expect(normalizeCountryCodes(undefined)).toEqual([]);
    expect(normalizeCountryCodes('PS')).toEqual([]);
    expect(normalizeCountryCodes(null)).toEqual([]);
  });
});

describe('isRelayConfiguredForRouting (safe default: blocked)', () => {
  it('true only when enabled AND has ≥1 country', () => {
    expect(isRelayConfiguredForRouting({ countryRoutingEnabled: true, allowedCountryCodes: ['PS'] })).toBe(true);
  });
  it('false when disabled', () => {
    expect(isRelayConfiguredForRouting({ countryRoutingEnabled: false, allowedCountryCodes: ['PS'] })).toBe(false);
  });
  it('false when no countries (including legacy relays with missing fields)', () => {
    expect(isRelayConfiguredForRouting({ countryRoutingEnabled: true, allowedCountryCodes: [] })).toBe(false);
    expect(isRelayConfiguredForRouting({})).toBe(false);
    expect(isRelayConfiguredForRouting({ allowedCountryCodes: ['PS'] })).toBe(false); // enabled missing
  });
});

describe('deviceServesCountry', () => {
  it('matches only explicitly-listed countries (no cross-country fallback)', () => {
    expect(deviceServesCountry({ allowedCountryCodes: ['PS', 'IL'] }, 'PS')).toBe(true);
    expect(deviceServesCountry({ allowedCountryCodes: ['PS', 'IL'] }, 'JO')).toBe(false);
    expect(deviceServesCountry({ allowedCountryCodes: [] }, 'PS')).toBe(false);
    expect(deviceServesCountry({}, 'PS')).toBe(false);
  });
});

describe('canDeviceClaimJobCountry — relay claim safety (defense in depth)', () => {
  it('a PS-only device may NOT claim a JO- or IL-tagged job', () => {
    expect(canDeviceClaimJobCountry(['PS'], 'JO')).toBe(false);
    expect(canDeviceClaimJobCountry(['PS'], 'IL')).toBe(false);
  });
  it('a device may claim a job tagged with a country it serves', () => {
    expect(canDeviceClaimJobCountry(['PS', 'JO'], 'JO')).toBe(true);
  });
  it('an unconfigured device (no countries) may claim NO country-tagged job', () => {
    expect(canDeviceClaimJobCountry([], 'PS')).toBe(false);
    expect(canDeviceClaimJobCountry(undefined, 'PS')).toBe(false);
    expect(canDeviceClaimJobCountry(null, 'PS')).toBe(false);
  });
  it('untagged jobs (legacy / sign-in OTP) remain claimable by any device', () => {
    expect(canDeviceClaimJobCountry([], '')).toBe(true);
    expect(canDeviceClaimJobCountry([], undefined)).toBe(true);
    expect(canDeviceClaimJobCountry(['PS'], null)).toBe(true);
  });
});
