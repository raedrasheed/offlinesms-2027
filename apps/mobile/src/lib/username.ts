// Username rules. Mirrored in functions/src/auth/claimUsername.ts — if you
// edit one, edit both.
//
// Format: 3–20 chars, lowercase a–z, digits 0–9, underscore, dot.
// Dots/underscores cannot start/end the username or appear consecutively.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin', 'admins', 'administrator',
  'support', 'help', 'helpdesk',
  'system', 'sys',
  'offlinesms', 'offline_sms', 'offline.sms',
  'official', 'staff', 'mod', 'moderator',
  'root', 'superuser',
  'null', 'undefined', 'nil',
  'me', 'you', 'self',
  'test', 'demo',
]);

export type UsernameValidationCode =
  | 'ok'
  | 'too-short'
  | 'too-long'
  | 'invalid-chars'
  | 'edge-punct'
  | 'consecutive-punct'
  | 'reserved';

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsername(raw: string): UsernameValidationCode {
  const u = normalizeUsername(raw);
  if (u.length < USERNAME_MIN) return 'too-short';
  if (u.length > USERNAME_MAX) return 'too-long';
  if (!/^[a-z0-9._]+$/.test(u)) return 'invalid-chars';
  if (/^[._]/.test(u) || /[._]$/.test(u)) return 'edge-punct';
  if (/[._]{2,}/.test(u)) return 'consecutive-punct';
  if (RESERVED_USERNAMES.has(u)) return 'reserved';
  return 'ok';
}

export function usernameErrorCopy(code: UsernameValidationCode): string | null {
  switch (code) {
    case 'ok':                 return null;
    case 'too-short':          return `Use at least ${USERNAME_MIN} characters.`;
    case 'too-long':           return `Use at most ${USERNAME_MAX} characters.`;
    case 'invalid-chars':      return 'Lowercase letters, numbers, dot, and underscore only.';
    case 'edge-punct':         return 'Username can’t start or end with a dot or underscore.';
    case 'consecutive-punct':  return 'No two dots or underscores in a row.';
    case 'reserved':           return 'That username is reserved.';
  }
}
