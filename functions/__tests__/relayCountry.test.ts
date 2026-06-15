import { describe, it, expect } from 'vitest';
import {
  normalizeCountryCodes, isRelayConfiguredForRouting, deviceServesCountry,
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
