// Pure display-name rule for the admin dashboard (no Firebase imports, so it
// is unit-testable). Mirrors the mobile/functions rule:
//   displayName → @username → stored snapshot (not uid-like) → "Unknown user".
// A uid is never the primary label; pages keep it visible as secondary text
// for auditing.

export const UNKNOWN_USER_LABEL = 'Unknown user';
export const PHONE_CONTACT_LABEL = 'Phone contact';

/** Phone-only SMS recipients / group contacts use synthetic `ext:<phone>` ids. */
export function isExternalId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('ext:');
}

export type UserNameInfo = {
  displayName: string | null;
  username: string | null;
};

export type UserNameMap = Record<string, UserNameInfo>;

function clean(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** True when `label` is the uid itself or a prefix of it (legacy snapshots). */
export function looksLikeUid(label: string | null | undefined, uid: string | null | undefined): boolean {
  if (!label || !uid) return false;
  const l = label.trim();
  return !!l && (l === uid || (l.length >= 2 && l.length <= uid.length && uid.startsWith(l)));
}

/** Normalise a users/{uid} document into name info. */
export function nameInfoFrom(data: Record<string, unknown> | null | undefined, uid?: string | null): UserNameInfo {
  const dn = clean(data?.displayName);
  return {
    displayName: dn && !looksLikeUid(dn, uid) ? dn : null,
    username: clean(data?.username)?.replace(/^@/, '') ?? null,
  };
}

/** The primary label for a user. */
export function userLabel(
  info: Partial<UserNameInfo> | null | undefined,
  opts: { uid?: string | null; snapshot?: string | null } = {},
): string {
  const dn = clean(info?.displayName);
  if (dn && !looksLikeUid(dn, opts.uid)) return dn;
  const un = clean(info?.username);
  if (un) return `@${un.replace(/^@/, '')}`;
  const snap = clean(opts.snapshot);
  if (snap && !looksLikeUid(snap, opts.uid)) return snap;
  return isExternalId(opts.uid) ? PHONE_CONTACT_LABEL : UNKNOWN_USER_LABEL;
}

/** Initial for an avatar bubble (never derived from the uid). */
export function userInitial(label: string): string {
  if (label === UNKNOWN_USER_LABEL || label === PHONE_CONTACT_LABEL) return '?';
  return label.replace(/^@/, '').slice(0, 1).toUpperCase() || '?';
}
