// Phase 23 — shared user-profile resolver (uid → displayName + photoURL).
//
// Reads users/{uid} once and caches in memory, so avatars and the reaction
// breakdown can show real names/photos without each component re-fetching.
// Falls back gracefully when a profile is missing.

import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

export interface UserProfile {
  displayName: string | null;
  photoURL: string | null;
}

const cache = new Map<string, UserProfile>();
const inflight = new Map<string, Promise<UserProfile>>();

export async function getUserProfile(uid: string): Promise<UserProfile> {
  if (!uid) return { displayName: null, photoURL: null };
  const cached = cache.get(uid);
  if (cached) return cached;
  const pending = inflight.get(uid);
  if (pending) return pending;

  const p = (async (): Promise<UserProfile> => {
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      const d = (snap.data() ?? {}) as { displayName?: string; username?: string; photoURL?: string | null };
      const profile: UserProfile = {
        displayName: d.displayName || (d.username ? `@${d.username}` : null),
        photoURL: d.photoURL ?? null,
      };
      cache.set(uid, profile);
      return profile;
    } catch {
      return { displayName: null, photoURL: null };
    } finally {
      inflight.delete(uid);
    }
  })();
  inflight.set(uid, p);
  return p;
}

/** Resolve a set of uids to profiles, updating as they load. */
export function useUserProfiles(uids: string[]): Record<string, UserProfile> {
  const [map, setMap] = useState<Record<string, UserProfile>>({});
  const key = Array.from(new Set(uids.filter(Boolean))).sort().join(',');
  useEffect(() => {
    let cancelled = false;
    const unique = key ? key.split(',') : [];
    if (unique.length === 0) { setMap({}); return; }
    Promise.all(unique.map(async (u) => [u, await getUserProfile(u)] as const)).then((entries) => {
      if (cancelled) return;
      const next: Record<string, UserProfile> = {};
      for (const [u, prof] of entries) next[u] = prof;
      setMap(next);
    });
    return () => { cancelled = true; };
  }, [key]);
  return map;
}
