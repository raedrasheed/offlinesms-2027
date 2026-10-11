// Server-side batch name resolver for admin pages.
//
// uid[] → { displayName, username } via adminDb.getAll on users/{uid} (one
// round trip per 100 distinct uids) so list pages show names instead of uids
// without a read per row. Never returns phone/email.

import { adminDb } from './firebase-admin';
import { isExternalId, nameInfoFrom, type UserNameMap } from './userLabel';

const CHUNK = 100;

export async function resolveUserNames(uids: Iterable<string | null | undefined>): Promise<UserNameMap> {
  const unique = [...new Set([...uids].filter((u): u is string => typeof u === 'string' && u.length > 0 && !isExternalId(u)))];
  const out: UserNameMap = {};
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    try {
      const snaps = await adminDb.getAll(...chunk.map(u => adminDb.collection('users').doc(u)));
      snaps.forEach((s, idx) => {
        out[chunk[idx]] = nameInfoFrom(s.data() as Record<string, unknown> | undefined, chunk[idx]);
      });
    } catch {
      // Best-effort: rows without a resolved name fall back to "Unknown user".
    }
  }
  return out;
}
