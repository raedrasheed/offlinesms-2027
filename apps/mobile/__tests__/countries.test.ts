import { describe, it, expect } from 'vitest';
import { availableCountries, ORDERED_COUNTRIES, PRIORITY_CODES } from '../src/lib/countries';

describe('availableCountries — phone sign-in picker source', () => {
  it('returns only the countries a relay currently serves', () => {
    const out = availableCountries(['PS', 'JO']);
    expect(out.map(c => c.code).sort()).toEqual(['JO', 'PS']);
  });

  it('preserves the priority ordering (region-relevant first)', () => {
    // PS and JO are both priority codes; PS precedes JO in PRIORITY_CODES.
    expect(PRIORITY_CODES.indexOf('PS')).toBeLessThan(PRIORITY_CODES.indexOf('JO'));
    expect(availableCountries(['JO', 'PS']).map(c => c.code)).toEqual(['PS', 'JO']);
  });

  it('is case-insensitive on the incoming ISO codes', () => {
    expect(availableCountries(['ps']).map(c => c.code)).toEqual(['PS']);
  });

  it('drops codes we have no metadata for, and returns [] for an empty set', () => {
    expect(availableCountries(['ZZ', 'XX'])).toEqual([]);
    expect(availableCountries([])).toEqual([]);
  });

  it('never offers more than the full ordered list', () => {
    const all = availableCountries(ORDERED_COUNTRIES.map(c => c.code));
    expect(all.length).toBe(ORDERED_COUNTRIES.length);
  });
});
