// Shared phone-number normalization (Phase 25 — external phone contacts).
//
// Pure + dependency-free so the identical logic can live in both the functions
// runtime and the mobile app without a cross-package build. Keep this file and
// apps/mobile/src/lib/phone.ts byte-for-byte in sync.

const E164_RE = /^\+[1-9]\d{6,14}$/;

/**
 * Normalize a user-entered phone number to E.164, or return null if it can't
 * be made into a plausible mobile number.
 *
 * - Strips spaces, parens, hyphens, dots.
 * - If the input already starts with "+", it's validated as-is.
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

  if (!s.startsWith('+')) {
    const dial = (defaultCountry ?? '').replace(/[\s()\-.]/g, '');
    if (dial.startsWith('+')) {
      s = s.replace(/^0+/, '');     // drop national trunk prefix
      s = dial + s;
    } else {
      return null;                  // no country context → can't disambiguate
    }
  }

  return E164_RE.test(s) ? s : null;
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
