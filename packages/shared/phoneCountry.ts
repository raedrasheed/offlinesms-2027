// Shared phone normalization + ISO country detection (country-based relay routing).
//
// Canonical source. Mirrored — NOT imported — by the functions runtime
// (functions/src/lib/phoneCountry.ts) because `firebase deploy` only uploads the
// functions/ directory, and into apps/dashboard/lib/phoneCountry.ts for the
// synchronous org-API country check. Keep the three copies in sync.
//
// Uses libphonenumber-js for accurate parsing + country detection (the spec
// requires not relying on raw dial prefixes alone).

import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

export type NormalizedPhone = {
  /** E.164 form (e.g. "+970599123456"); "" when it can't be formed. */
  e164: string;
  /** ISO 3166-1 alpha-2 (e.g. "PS"); null for invalid/undetectable. */
  countryCode: string | null;
  isValid: boolean;
  /** Why it failed, when !isValid (empty | unparseable | invalid | parse-error). */
  reason?: string;
};

/**
 * Normalize a user-entered phone number and detect its ISO alpha-2 country.
 *
 * @param inputPhone   raw user input (E.164, national, or messy formatting)
 * @param defaultCountry optional ISO alpha-2 (e.g. "PS") used to interpret
 *                       national-format input that lacks a country prefix.
 */
export function normalizePhoneAndCountry(inputPhone: string, defaultCountry?: string): NormalizedPhone {
  if (typeof inputPhone !== 'string' || inputPhone.trim() === '') {
    return { e164: '', countryCode: null, isValid: false, reason: 'empty' };
  }

  let parsed;
  try {
    parsed = parsePhoneNumberFromString(inputPhone.trim(), defaultCountry as CountryCode | undefined);
  } catch {
    return { e164: '', countryCode: null, isValid: false, reason: 'parse-error' };
  }

  if (!parsed) {
    return { e164: '', countryCode: null, isValid: false, reason: 'unparseable' };
  }
  if (!parsed.isValid()) {
    return { e164: parsed.number ?? '', countryCode: parsed.country ?? null, isValid: false, reason: 'invalid' };
  }
  return { e164: parsed.number, countryCode: parsed.country ?? null, isValid: true };
}
