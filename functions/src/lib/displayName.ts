// Shared public-name resolution for Cloud Functions.
//
// One rule everywhere a function stores or sends a person's name:
//   users/{uid}.displayName → "@" + users/{uid}.username → null.
// A uid (or a fragment of it) is NEVER used as a display string: when there
// is no name we store null and let each client render its own translated
// "Unknown user". Internal ids stay in their own fields (senderUid, uid…).

import type { Firestore } from 'firebase-admin/firestore';

export interface PublicNameSource {
  displayName?: unknown;
  username?: unknown;
}

function clean(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** True when `label` is the uid itself or a prefix of it (legacy snapshots). */
export function looksLikeUid(label: string | null | undefined, uid: string | null | undefined): boolean {
  if (!label || !uid) return false;
  const l = label.trim();
  return !!l && (l === uid || (l.length >= 2 && l.length <= uid.length && uid.startsWith(l)));
}

/** A stored snapshot that is a real name, or null (empty / uid-like). */
export function cleanNameSnapshot(snapshot: unknown, uid: string | null | undefined): string | null {
  const s = clean(snapshot);
  return s && !looksLikeUid(s, uid) ? s : null;
}

/** displayName → @username → null, from a users/{uid} document's data. */
export function publicNameFrom(data: PublicNameSource | null | undefined, uid?: string | null): string | null {
  if (!data) return null;
  const dn = cleanNameSnapshot(data.displayName, uid);
  if (dn) return dn;
  const un = clean(data.username);
  return un ? `@${un.replace(/^@/, '')}` : null;
}

/** Resolve one user's public name (one read). */
export async function resolvePublicName(db: Firestore, uid: string | null | undefined): Promise<string | null> {
  if (!uid) return null;
  try {
    const snap = await db.collection('users').doc(uid).get();
    return publicNameFrom(snap.data() as PublicNameSource | undefined, uid);
  } catch {
    return null;
  }
}

/** Resolve many users' public names with batched getAll reads (≤100 per call). */
export async function resolvePublicNames(
  db: Firestore,
  uids: Iterable<string | null | undefined>,
): Promise<Map<string, string | null>> {
  const unique = [...new Set([...uids].filter((u): u is string => !!u))];
  const out = new Map<string, string | null>();
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    try {
      const snaps = await db.getAll(...chunk.map((u) => db.collection('users').doc(u)));
      snaps.forEach((s, idx) => out.set(chunk[idx], publicNameFrom(s.data() as PublicNameSource | undefined, chunk[idx])));
    } catch {
      for (const u of chunk) if (!out.has(u)) out.set(u, null);
    }
  }
  return out;
}
