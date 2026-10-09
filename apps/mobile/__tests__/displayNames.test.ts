import { describe, it, expect, vi } from 'vitest';
import {
  createProfileStore,
  displayNameFor,
  isExternalId,
  looksLikeUid,
  normalizeProfile,
  profileName,
  NameProfile,
} from '../src/lib/displayNames.pure';

const UID = 'CjEJcDq81LmZ0pQ2xYzA';
const prof = (p: Partial<NameProfile>): NameProfile => ({
  displayName: null, username: null, photoURL: null, about: null, ...p,
});

describe('displayNameFor', () => {
  const base = { uid: UID, fallback: 'Unknown user' };

  it('prefers the live displayName over any snapshot', () => {
    expect(displayNameFor(prof({ displayName: 'Sara' }), { ...base, snapshot: 'Old Sara' })).toBe('Sara');
  });

  it('falls back to @username when there is no displayName', () => {
    expect(displayNameFor(prof({ username: 'sara' }), base)).toBe('@sara');
    expect(displayNameFor(prof({ username: '@sara' }), base)).toBe('@sara');
  });

  it('uses a stored snapshot only while the profile has no name', () => {
    expect(displayNameFor(null, { ...base, snapshot: 'Sara' })).toBe('Sara');
    expect(displayNameFor(prof({}), { ...base, snapshot: ['', null, 'Sara'] })).toBe('Sara');
  });

  it('never shows a uid or a uid fragment stored as a "name" (legacy rows)', () => {
    expect(displayNameFor(null, { ...base, snapshot: UID })).toBe('Unknown user');
    expect(displayNameFor(null, { ...base, snapshot: UID.slice(0, 6) })).toBe('Unknown user');
    expect(displayNameFor(null, { ...base, snapshot: UID.slice(0, 2) })).toBe('Unknown user');
    // ...but the next real snapshot still wins.
    expect(displayNameFor(null, { ...base, snapshot: [UID.slice(0, 6), 'Sara'] })).toBe('Sara');
  });

  it('labels the signed-in user with the translated "You" only when asked', () => {
    expect(displayNameFor(prof({ displayName: 'Raed' }), { ...base, isMe: true, youLabel: 'أنت' })).toBe('أنت');
    expect(displayNameFor(prof({ displayName: 'Raed' }), { ...base, isMe: false, youLabel: 'أنت' })).toBe('Raed');
  });

  it('returns the translated fallback when nothing is known', () => {
    expect(displayNameFor(undefined, { uid: UID, fallback: 'مستخدم غير معروف' })).toBe('مستخدم غير معروف');
    expect(displayNameFor(prof({ displayName: '   ' }), base)).toBe('Unknown user');
  });
});

describe('helpers', () => {
  it('looksLikeUid detects the uid and its prefixes only', () => {
    expect(looksLikeUid(UID, UID)).toBe(true);
    expect(looksLikeUid('CjEJcD', UID)).toBe(true);
    expect(looksLikeUid('C', UID)).toBe(false); // too short to be a deliberate fragment
    expect(looksLikeUid('Sara', UID)).toBe(false);
    expect(looksLikeUid('Sara', null)).toBe(false);
  });

  it('normalizeProfile trims and nulls empty fields', () => {
    expect(normalizeProfile({ displayName: '  Sara ', username: '', photoURL: 'x' }))
      .toEqual({ displayName: 'Sara', username: null, photoURL: 'x', about: null });
    expect(normalizeProfile(undefined)).toEqual({ displayName: null, username: null, photoURL: null, about: null });
  });

  it('profileName returns null without a name', () => {
    expect(profileName(prof({}))).toBeNull();
    expect(profileName(prof({ username: 'sara' }))).toBe('@sara');
  });

  it('recognises phone-only external ids', () => {
    expect(isExternalId('ext:+970591234567')).toBe(true);
    expect(isExternalId(UID)).toBe(false);
  });
});

describe('createProfileStore', () => {
  function harness(ttlMs = 1000) {
    let clock = 0;
    const queue: Array<() => void> = [];
    const calls: string[][] = [];
    const db: Record<string, NameProfile> = {
      a: prof({ displayName: 'Ann' }),
      b: prof({ username: 'bob' }),
    };
    const store = createProfileStore({
      ttlMs,
      maxBatch: 2,
      now: () => clock,
      schedule: (fn) => { queue.push(fn); },
      fetchBatch: async (uids) => {
        calls.push([...uids]);
        const out: Record<string, NameProfile> = {};
        for (const u of uids) if (db[u]) out[u] = db[u];
        return out;
      },
    });
    const flush = async () => {
      while (queue.length) queue.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    };
    return { store, calls, db, flush, tick: (ms: number) => { clock += ms; } };
  }

  it('batches and de-duplicates requests made in the same tick', async () => {
    const h = harness();
    h.store.request(['a', 'b', 'a']);
    h.store.request(['b', 'c']);
    await h.flush();
    // maxBatch 2 → two round trips for three distinct uids, none repeated.
    expect(h.calls.flat().sort()).toEqual(['a', 'b', 'c']);
    expect(h.calls).toHaveLength(2);
    expect(h.store.peek('a')?.displayName).toBe('Ann');
    expect(h.store.peek('c')).toEqual(prof({})); // missing profile cached as empty
  });

  it('serves fresh entries from cache without refetching', async () => {
    const h = harness();
    h.store.request(['a']);
    await h.flush();
    h.store.request(['a']);
    await h.flush();
    expect(h.calls).toHaveLength(1);
  });

  it('re-fetches after the TTL and notifies listeners of a rename', async () => {
    const h = harness(1000);
    const listener = vi.fn();
    h.store.subscribe(['a'], listener);
    h.store.request(['a']);
    await h.flush();
    expect(listener).toHaveBeenCalledTimes(1);

    h.db.a = prof({ displayName: 'Anna' });
    h.tick(1001);
    expect(await h.store.get('a')).toEqual(prof({ displayName: 'Ann' })); // stale served at once
    await h.flush();
    expect(h.store.peek('a')?.displayName).toBe('Anna');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not notify when a refresh returns the same profile', async () => {
    const h = harness(10);
    const listener = vi.fn();
    h.store.subscribe(['a'], listener);
    h.store.request(['a']);
    await h.flush();
    h.tick(20);
    h.store.request(['a']);
    await h.flush();
    expect(h.calls).toHaveLength(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('get() waits for the first load', async () => {
    const h = harness();
    const p = h.store.get('b');
    await h.flush();
    expect(profileName(await p)).toBe('@bob');
  });

  it('invalidate forces the next request to refetch; prime seeds the cache', async () => {
    const h = harness();
    h.store.prime('a', prof({ displayName: 'Primed' }));
    h.store.request(['a']);
    await h.flush();
    expect(h.calls).toHaveLength(0);
    h.store.invalidate('a');
    h.store.request(['a']);
    await h.flush();
    expect(h.calls).toEqual([['a']]);
    expect(h.store.peek('a')?.displayName).toBe('Ann');
  });

  it('never fetches phone-only external ids', async () => {
    const h = harness();
    h.store.request(['ext:+970591234567']);
    await h.flush();
    expect(h.calls).toHaveLength(0);
  });

  it('keeps stale data when a fetch fails', async () => {
    let fail = false;
    let clock = 0;
    const queue: Array<() => void> = [];
    const store = createProfileStore({
      ttlMs: 10,
      now: () => clock,
      schedule: (fn) => { queue.push(fn); },
      fetchBatch: async () => { if (fail) throw new Error('offline'); return { a: prof({ displayName: 'Ann' }) }; },
    });
    const flush = async () => { while (queue.length) queue.shift()!(); await new Promise((r) => setTimeout(r, 0)); };
    store.request(['a']);
    await flush();
    fail = true;
    clock = 100;
    store.request(['a']);
    await flush();
    expect(store.peek('a')?.displayName).toBe('Ann');
  });

  it('unsubscribe stops notifications', async () => {
    const h = harness();
    const listener = vi.fn();
    const off = h.store.subscribe(['a'], listener);
    off();
    h.store.request(['a']);
    await h.flush();
    expect(listener).not.toHaveBeenCalled();
  });
});
