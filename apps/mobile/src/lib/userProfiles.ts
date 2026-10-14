// Unified user-profile + display-name resolver (uid → name / username / photo).
//
// This is the ONE place the app turns a uid into something to show. Every
// screen that labels a person (bubbles, reply previews, chat list, members,
// reactions, typing, pickers, status, points, SMS reports…) goes through it,
// so a rename shows up everywhere and nothing ever prints a uid.
//
//   • Cache: in-memory, shared by all screens (see displayNames.pure.ts).
//   • Batching: uids requested in the same tick are fetched together with one
//     `documentId() in [...]` query per 30 uids — never one read per message.
//   • Freshness: entries older than the TTL are served immediately and
//     re-fetched in the background; subscribers re-render when a name changes.
//     While a screen listens, its uids are re-checked on a timer (not while
//     the app is in the background), so a rename shows without other activity.
//   • Naming rule: displayNameFor() — displayName → @username → stored
//     snapshot (only while unknown, never a uid fragment) → translated
//     "Unknown user" (or "You" for the signed-in user).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import i18n from 'i18next';
import { useTranslation } from 'react-i18next';
import { auth, db } from './firebase';
import {
  createProfileStore,
  displayNameFor,
  EMPTY_PROFILE,
  isExternalId,
  NameProfile,
  normalizeProfile,
} from './displayNames.pure';

export type UserProfile = NameProfile;

const store = createProfileStore({
  maxBatch: 30, // Firestore `in` limit
  isActive: () => AppState.currentState === 'active',
  async fetchBatch(uids) {
    const snap = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', uids)));
    const out: Record<string, NameProfile> = {};
    snap.forEach((d) => { out[d.id] = normalizeProfile(d.data()); });
    return out;
  },
});

/** Raw profile store — for non-React callers (e.g. the chat-list feeder). */
export const profileStore = store;

export function getUserProfile(uid: string): Promise<UserProfile> {
  return store.get(uid);
}

/** Force the next read of `uid` (or everyone) to re-fetch, e.g. after a rename. */
export function invalidateUserProfile(uid?: string): void {
  store.invalidate(uid);
  if (uid) store.request([uid]);
}

/** Seed the cache from a users/{uid} document we already hold. */
export function primeUserProfile(uid: string, raw: unknown): void {
  store.prime(uid, normalizeProfile(raw));
}

export interface NameOpts {
  /** Stored snapshot (message/member/reply) — used only while the profile is unknown. */
  snapshot?: string | null | ReadonlyArray<string | null | undefined>;
  /** Label the signed-in user as "You" (default false: show their real name). */
  selfAsYou?: boolean;
  /** Override the generic fallback label. */
  fallback?: string;
}

/** Non-hook name resolution against whatever is cached right now. */
export function displayNameFromCache(uid: string | null | undefined, opts: NameOpts = {}): string {
  const me = auth.currentUser?.uid ?? null;
  return displayNameFor(uid ? store.peek(uid) : null, {
    uid: uid ?? null,
    isMe: !!uid && !!opts.selfAsYou && uid === me,
    youLabel: i18n.t('names.you'),
    snapshot: opts.snapshot ?? null,
    fallback: opts.fallback ?? i18n.t(isExternalId(uid) ? 'names.phoneContact' : 'names.unknownUser'),
  });
}

/** Resolve one uid's display name (async, cached; never a uid). */
export async function resolveDisplayName(uid: string, opts: NameOpts = {}): Promise<string> {
  if (uid) await store.get(uid);
  return displayNameFromCache(uid, opts);
}

function useUidKey(uids: Array<string | null | undefined>): string {
  return Array.from(new Set(uids.filter((u): u is string => !!u && !isExternalId(u)))).sort().join(',');
}

/** Subscribe to profile changes for `uids`; returns a version counter. */
function useProfileVersion(key: string): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const unique = key ? key.split(',') : [];
    if (unique.length === 0) return;
    const unsub = store.subscribe(unique, () => setVersion((v) => v + 1));
    store.request(unique);
    return unsub;
  }, [key]);
  return version;
}

/** Resolve a set of uids to profiles, updating as they load or change. */
export function useUserProfiles(uids: Array<string | null | undefined>): Record<string, UserProfile> {
  const key = useUidKey(uids);
  const version = useProfileVersion(key);
  return useMemo(() => {
    const next: Record<string, UserProfile> = {};
    for (const u of key ? key.split(',') : []) {
      const p = store.peek(u);
      if (p) next[u] = p;
    }
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
}

export type NameResolver = (uid: string | null | undefined, opts?: NameOpts) => string;

/**
 * Hook: a stable-per-change `nameFor(uid, opts)` covering `uids`.
 * Names update live as profiles load or are renamed.
 */
export function useDisplayNames(uids: Array<string | null | undefined>): NameResolver {
  const { t } = useTranslation();
  const profiles = useUserProfiles(uids);
  const me = auth.currentUser?.uid ?? null;
  return useCallback<NameResolver>((uid, opts = {}) => {
    // A uid outside the hook's set still resolves from the shared cache
    // (and is queued for a fetch) rather than printing the uid.
    let prof: NameProfile | undefined = uid ? profiles[uid] : undefined;
    if (uid && !prof) { prof = store.peek(uid); if (!prof) store.request([uid]); }
    return displayNameFor(prof ?? EMPTY_PROFILE, {
      uid: uid ?? null,
      isMe: !!uid && !!opts.selfAsYou && uid === me,
      youLabel: t('names.you'),
      snapshot: opts.snapshot ?? null,
      // Phone-only contacts have no profile: say so instead of "Unknown user".
      fallback: opts.fallback ?? (isExternalId(uid) ? t('names.phoneContact') : t('names.unknownUser')),
    });
  }, [profiles, me, t]);
}

/** Hook: one uid's display name. */
export function useDisplayName(uid: string | null | undefined, opts: NameOpts = {}): string {
  const nameFor = useDisplayNames([uid]);
  return nameFor(uid, opts);
}

/**
 * Hook: label an already-loaded profile-like row (search results, contact
 * matches...) with the unified rule: displayName, then @username, then the
 * translated "Unknown user".
 */
export function useProfileLabel(): (p: (Partial<NameProfile> & { uid?: string | null }) | null | undefined) => string {
  const { t } = useTranslation();
  return useCallback(
    (p) => displayNameFor(p, { uid: p?.uid ?? null, fallback: t('names.unknownUser') }),
    [t],
  );
}
