import { describe, it, expect } from 'vitest';
import {
  cleanNameSnapshot, looksLikeUid, publicNameFrom, resolvePublicName, resolvePublicNames,
} from '../src/lib/displayName';

const UID = 'CjEJcDq81LmZ0pQ2xYzA';

describe('publicNameFrom', () => {
  it('displayName → @username → null', () => {
    expect(publicNameFrom({ displayName: 'Sara', username: 'sara' }, UID)).toBe('Sara');
    expect(publicNameFrom({ displayName: '  ', username: 'sara' }, UID)).toBe('@sara');
    expect(publicNameFrom({ username: '@sara' }, UID)).toBe('@sara');
    expect(publicNameFrom({}, UID)).toBeNull();
    expect(publicNameFrom(undefined, UID)).toBeNull();
  });

  it('never returns the uid (or a fragment) as a name', () => {
    expect(publicNameFrom({ displayName: UID }, UID)).toBeNull();
    expect(publicNameFrom({ displayName: UID.slice(0, 6), username: 'sara' }, UID)).toBe('@sara');
  });
});

describe('cleanNameSnapshot / looksLikeUid', () => {
  it('drops empty and uid-like snapshots', () => {
    expect(cleanNameSnapshot('Sara', UID)).toBe('Sara');
    expect(cleanNameSnapshot(UID, UID)).toBeNull();
    expect(cleanNameSnapshot(UID.slice(0, 6), UID)).toBeNull();
    expect(cleanNameSnapshot('', UID)).toBeNull();
    expect(cleanNameSnapshot(42, UID)).toBeNull();
  });
  it('looksLikeUid only matches the uid or its prefixes', () => {
    expect(looksLikeUid('CjEJcD', UID)).toBe(true);
    expect(looksLikeUid('Sara', UID)).toBe(false);
    expect(looksLikeUid('C', UID)).toBe(false);
  });
});

// Minimal Firestore double: users/{uid} docs + getAll accounting.
function fakeDb(users: Record<string, Record<string, unknown>>) {
  const calls = { get: 0, getAll: 0 };
  const ref = (id: string) => ({
    id,
    get: async () => { calls.get++; return { data: () => users[id] }; },
  });
  const db = {
    collection: () => ({ doc: (id: string) => ref(id) }),
    getAll: async (...refs: Array<{ id: string }>) => {
      calls.getAll++;
      return refs.map((r) => ({ data: () => users[r.id] }));
    },
  };
  return { db: db as any, calls };
}

describe('resolvePublicName(s)', () => {
  it('resolves one user', async () => {
    const { db } = fakeDb({ a: { displayName: 'Ann' } });
    expect(await resolvePublicName(db, 'a')).toBe('Ann');
    expect(await resolvePublicName(db, 'missing')).toBeNull();
    expect(await resolvePublicName(db, null)).toBeNull();
  });

  it('batches distinct uids into getAll calls of ≤100', async () => {
    const users: Record<string, Record<string, unknown>> = {};
    const ids = Array.from({ length: 150 }, (_, i) => `u${i}`);
    for (const id of ids) users[id] = { username: id };
    const { db, calls } = fakeDb(users);
    const out = await resolvePublicNames(db, [...ids, ...ids, null, undefined]);
    expect(calls.getAll).toBe(2);
    expect(out.size).toBe(150);
    expect(out.get('u7')).toBe('@u7');
  });
});
