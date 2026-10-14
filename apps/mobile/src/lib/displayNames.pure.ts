// Unified display-name resolution — pure logic (no Firebase / React Native
// imports) so it can be unit tested in node.
//
// The ONE rule for turning a user into a label shown in the UI:
//   live profile displayName → @username → (stored snapshot, only while the
//   live profile is unknown) → translated fallback ("Unknown user" / "You").
// A uid (or a prefix of it — legacy rows stored `uid.slice(0, 6)`) is NEVER a
// display label.
//
// `createProfileStore` is the cache behind it: batched + de-duplicated fetches
// (one Firestore query per ≤30 uids instead of one read per message), with a
// TTL so name changes are picked up (stale-while-revalidate), and per-uid
// listeners so hooks re-render only when a uid they use changes. While anyone
// listens, a timer re-requests the listened uids, so an open screen picks up a
// rename after the TTL even when nothing else on it changes.

export interface NameProfile {
  displayName: string | null;
  username: string | null;
  photoURL: string | null;
  about: string | null;
}

export const EMPTY_PROFILE: NameProfile = Object.freeze({
  displayName: null, username: null, photoURL: null, about: null,
}) as NameProfile;

/**
 * Phone-only group contacts / SMS recipients use synthetic ids `ext:<phone>`.
 * They have no users/{uid} profile, so they are never fetched.
 */
export const EXTERNAL_ID_PREFIX = 'ext:';
export function isExternalId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(EXTERNAL_ID_PREFIX);
}

/** Normalise a raw users/{uid} document into a NameProfile. */
export function normalizeProfile(raw: unknown): NameProfile {
  const d = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    displayName: str(d.displayName),
    username: str(d.username),
    photoURL: str(d.photoURL),
    about: str(d.about),
  };
}

/**
 * True when `label` is the uid itself or a prefix of it (old clients and
 * functions persisted `uid.slice(0, 6)` / the full uid as a "name").
 */
export function looksLikeUid(label: string | null | undefined, uid: string | null | undefined): boolean {
  if (!label || !uid) return false;
  const l = label.trim();
  if (!l) return false;
  return l === uid || (l.length >= 2 && l.length <= uid.length && uid.startsWith(l));
}

/** Best real name from a profile: displayName → @username → null. */
export function profileName(profile: Partial<NameProfile> | null | undefined): string | null {
  if (!profile) return null;
  const dn = typeof profile.displayName === 'string' ? profile.displayName.trim() : '';
  if (dn) return dn;
  const un = typeof profile.username === 'string' ? profile.username.trim().replace(/^@/, '') : '';
  if (un) return `@${un}`;
  return null;
}

export interface DisplayNameOptions {
  /** The uid being labelled (used to reject uid-like snapshots). */
  uid?: string | null;
  /** True when the uid is the signed-in user. */
  isMe?: boolean;
  /** Label for the signed-in user (translated "You"). Used only with isMe. */
  youLabel?: string;
  /**
   * Stored name snapshot(s) (message/member/reply). Fallback only; the first
   * non-empty one that isn't a uid fragment wins.
   */
  snapshot?: string | null | ReadonlyArray<string | null | undefined>;
  /** Translated generic label when nothing is known ("Unknown user"). */
  fallback: string;
}

/**
 * The single display-name rule. Live profile name wins over any snapshot
 * (snapshots go stale when the user renames); the snapshot is used only when
 * the profile has no name, and only if it isn't a uid fragment.
 */
export function displayNameFor(
  profile: Partial<NameProfile> | null | undefined,
  opts: DisplayNameOptions,
): string {
  if (opts.isMe && opts.youLabel) return opts.youLabel;
  const live = profileName(profile);
  if (live) return live;
  const snaps = Array.isArray(opts.snapshot) ? opts.snapshot : [opts.snapshot];
  for (const raw of snaps) {
    const snap = typeof raw === 'string' ? raw.trim() : '';
    if (snap && snap !== opts.fallback && !looksLikeUid(snap, opts.uid)) return snap;
  }
  return opts.fallback;
}

// ── Cache / store ───────────────────────────────────────────────────────────

export interface ProfileStoreOptions {
  /** Fetch up to `maxBatch` profiles in one round trip. Missing uid → absent/null. */
  fetchBatch: (uids: string[]) => Promise<Record<string, NameProfile | null | undefined>>;
  /** Freshness window; older entries are re-fetched on next use. */
  ttlMs?: number;
  maxBatch?: number;
  now?: () => number;
  /** Schedules the batch flush (defaults to setTimeout 0). */
  schedule?: (fn: () => void) => void;
  /** How often listened uids are re-requested; only stale ones are fetched (default ttl/4). */
  refreshEveryMs?: number;
  /** Starts and stops that timer (defaults to setInterval/clearInterval). */
  interval?: { start: (fn: () => void, ms: number) => unknown; stop: (handle: unknown) => void };
  /** False skips a refresh (e.g. while the app is in the background). */
  isActive?: () => boolean;
}

export interface ProfileStore {
  /** Cached profile (possibly stale) or undefined when never loaded. */
  peek(uid: string): NameProfile | undefined;
  /** Ensure the uids are loaded/fresh; batches with other calls in the same tick. */
  request(uids: Iterable<string>): void;
  /** Promise for one profile (a cached value resolves at once, refreshing if stale). */
  get(uid: string): Promise<NameProfile>;
  /** Seed/replace a profile (e.g. from a live doc we already have). */
  prime(uid: string, profile: NameProfile): void;
  /** Mark stale so the next use re-fetches (e.g. after the user renames). */
  invalidate(uid?: string): void;
  /** Listen for changes to any of `uids`; returns unsubscribe. */
  subscribe(uids: Iterable<string>, listener: () => void): () => void;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function createProfileStore(opts: ProfileStoreOptions): ProfileStore {
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const maxBatch = Math.max(1, opts.maxBatch ?? 30);
  const now = opts.now ?? (() => Date.now());
  const schedule = opts.schedule ?? ((fn: () => void) => { setTimeout(fn, 0); });
  const refreshEvery = opts.refreshEveryMs ?? Math.max(1000, Math.floor(ttl / 4));
  const interval = opts.interval ?? {
    start: (fn: () => void, ms: number) => setInterval(fn, ms),
    stop: (h: unknown) => clearInterval(h as ReturnType<typeof setInterval>),
  };
  const isActive = opts.isActive ?? (() => true);
  let refreshTimer: unknown = null;

  const cache = new Map<string, { profile: NameProfile; at: number }>();
  const listeners = new Map<string, Set<() => void>>();
  const pending = new Set<string>();           // queued for the next flush
  const inflight = new Map<string, Promise<void>>();
  const waiters = new Map<string, Array<() => void>>();
  let flushScheduled = false;

  const isFresh = (uid: string) => {
    const e = cache.get(uid);
    return !!e && now() - e.at < ttl;
  };

  const notify = (uids: Iterable<string>) => {
    const fired = new Set<() => void>();
    for (const u of uids) {
      const set = listeners.get(u);
      if (!set) continue;
      for (const l of set) {
        if (fired.has(l)) continue;
        fired.add(l);
        try { l(); } catch { /* listener errors never break the store */ }
      }
    }
  };

  const sameProfile = (a: NameProfile | undefined, b: NameProfile) =>
    !!a && a.displayName === b.displayName && a.username === b.username &&
    a.photoURL === b.photoURL && a.about === b.about;

  const settle = (uid: string) => {
    const w = waiters.get(uid);
    waiters.delete(uid);
    w?.forEach((fn) => fn());
  };

  const flush = () => {
    flushScheduled = false;
    const uids = [...pending];
    pending.clear();
    for (let i = 0; i < uids.length; i += maxBatch) {
      const chunk = uids.slice(i, i + maxBatch);
      const p = (async () => {
        let result: Record<string, NameProfile | null | undefined> = {};
        let ok = true;
        try { result = await opts.fetchBatch(chunk); } catch { ok = false; }
        const changed: string[] = [];
        const at = now();
        for (const uid of chunk) {
          inflight.delete(uid);
          if (!ok) {
            // Keep any stale value; record an empty profile only when we had
            // nothing so callers stop waiting (retried after TTL).
            // Either way, retry in ~30s rather than on every use.
            const retryAt = at - ttl + Math.min(30_000, ttl);
            const prev = cache.get(uid);
            if (prev) prev.at = retryAt;
            else { cache.set(uid, { profile: EMPTY_PROFILE, at: retryAt }); changed.push(uid); }
          } else {
            const next = result[uid] ?? EMPTY_PROFILE;
            const prev = cache.get(uid)?.profile;
            cache.set(uid, { profile: next, at });
            if (!sameProfile(prev, next)) changed.push(uid);
          }
          settle(uid);
        }
        notify(changed);
      })();
      for (const uid of chunk) inflight.set(uid, p);
    }
  };

  const request = (uids: Iterable<string>) => {
    let added = false;
    for (const uid of uids) {
      if (!uid || isExternalId(uid) || isFresh(uid) || inflight.has(uid) || pending.has(uid)) continue;
      pending.add(uid);
      added = true;
    }
    if (added && !flushScheduled) {
      flushScheduled = true;
      schedule(flush);
    }
  };

  // Runs only while someone listens; each tick fetches the listened uids whose
  // entry passed the TTL (request() skips fresh and in-flight ones).
  const syncRefreshTimer = () => {
    if (listeners.size > 0 && refreshTimer === null) {
      refreshTimer = interval.start(() => { if (isActive()) request(listeners.keys()); }, refreshEvery);
    } else if (listeners.size === 0 && refreshTimer !== null) {
      interval.stop(refreshTimer);
      refreshTimer = null;
    }
  };

  return {
    peek: (uid) => cache.get(uid)?.profile,
    request,
    get(uid) {
      if (!uid || isExternalId(uid)) return Promise.resolve(EMPTY_PROFILE);
      const cached = cache.get(uid);
      if (cached) {
        // Stale-while-revalidate: answer now, refresh in the background.
        if (!isFresh(uid)) request([uid]);
        return Promise.resolve(cached.profile);
      }
      return new Promise<NameProfile>((resolve) => {
        const list = waiters.get(uid) ?? [];
        list.push(() => resolve(cache.get(uid)?.profile ?? EMPTY_PROFILE));
        waiters.set(uid, list);
        request([uid]);
      });
    },
    prime(uid, profile) {
      if (!uid) return;
      const prev = cache.get(uid)?.profile;
      cache.set(uid, { profile, at: now() });
      settle(uid);
      if (!sameProfile(prev, profile)) notify([uid]);
    },
    invalidate(uid) {
      const expire = (u: string) => {
        const e = cache.get(u);
        if (e) e.at = -Infinity;
      };
      if (uid) expire(uid); else for (const u of cache.keys()) expire(u);
    },
    subscribe(uids, listener) {
      const list = [...new Set(uids)].filter(Boolean);
      for (const u of list) {
        let set = listeners.get(u);
        if (!set) { set = new Set(); listeners.set(u, set); }
        set.add(listener);
      }
      syncRefreshTimer();
      return () => {
        for (const u of list) {
          const set = listeners.get(u);
          if (!set) continue;
          set.delete(listener);
          if (set.size === 0) listeners.delete(u);
        }
        syncRefreshTimer();
      };
    },
  };
}
