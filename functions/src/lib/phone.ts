// Shared phone-number normalization (Phase 25 — external phone contacts).
//
// Pure + dependency-free so the identical logic can live in both the functions
// runtime and the mobile app without a cross-package build. Keep this file and
// apps/mobile/src/lib/phone.ts byte-for-byte in sync.

const E164_RE = /^\+[1-9]\d{6,14}$/;

// Country dial codes (digits, no "+") that an entered number may already carry
// without a leading "+". Region-relevant: Palestine uses both +970 and +972, so
// a contact stored as "972599…" must NOT be treated as a national number and
// given a SECOND country code (the "+1972599…" bug). National Palestinian mobile
// numbers are 059X/056X, so they never start with these prefixes.
const KNOWN_DIAL_CODES = ['970', '972'];

/**
 * Normalize a user-entered phone number to E.164, or return null if it can't
 * be made into a plausible mobile number.
 *
 * - Strips spaces, parens, hyphens, dots.
 * - "00" international access prefix → "+".
 * - If the input already starts with "+", it's validated and left UNTOUCHED
 *   (any country — foreign numbers are never re-coded).
 * - If it already starts with a known country code but lost its "+"
 *   (e.g. "972599…"), the "+" is restored — the default dial is NOT prepended.
 * - Otherwise, when `defaultCountry` is provided as a dial code (e.g. "+970"),
 *   a leading national "0" trunk prefix is dropped and the dial code prepended.
 *
 * `defaultCountry` accepts a dial code string ("+970"). ISO country codes are
 * intentionally NOT resolved here to stay dependency-free; the mobile picker
 * already works in dial codes and passes one through.
 */
export function normalizePhoneToE164(input: string, defaultCountry?: string): string | null {
  if (typeof input !== 'string') return null;
  let s = input.replace(/[\s()\-.]/g, '');
  if (!s) return null;

  // "00" international access prefix → "+".
  if (s.startsWith('00')) s = '+' + s.slice(2);

  // Already international (any country): validate and leave untouched.
  if (s.startsWith('+')) {
    return E164_RE.test(s) ? s : null;
  }

  const digits = s.replace(/\D/g, '');
  if (!digits) return null;

  // Already carries a country code but lost its "+": restore it rather than
  // prepending another dial code (avoids "+1" + "972599…").
  for (const cc of KNOWN_DIAL_CODES) {
    if (digits.startsWith(cc)) {
      const intl = '+' + digits;
      return E164_RE.test(intl) ? intl : null;
    }
  }

  // National format: drop the trunk "0" and prepend the default dial code.
  const dial = (defaultCountry ?? '').replace(/[\s()\-.]/g, '');
  if (!dial.startsWith('+')) return null;   // no country context → can't disambiguate
  const national = digits.replace(/^0+/, '');
  return E164_RE.test(dial + national) ? dial + national : null;
}

/** True when the string is already valid E.164. */
export function isE164(s: string): boolean {
  return typeof s === 'string' && E164_RE.test(s);
}

/** Firestore-safe id / dedupe key for a phone (digits only, no plus). */
export function phoneDigits(e164: string): string {
  return (e164 ?? '').replace(/\D/g, '');
}

/** Display mask: keep the last 4 digits, e.g. "+972591234567" → "••• 4567". */
export function maskPhone(e164: string): string {
  const d = phoneDigits(e164);
  if (d.length < 4) return '•••';
  return `••• ${d.slice(-4)}`;
}
