import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqlJsDb, type CountingDb } from '../support/sqljsDb';

let db: CountingDb;
vi.mock('../../src/localdb/connection', () => ({ getDb: () => db, getCurrentUid: () => 'voter' }));

import { nextVoteSeq, resetVoteSeqCache } from '../../src/localdb/pollVoteSeq';
import { getState } from '../../src/localdb/repositories/syncStateRepo';

beforeEach(async () => { db = await createSqlJsDb(); resetVoteSeqCache(); });
afterEach(() => { vi.useRealTimers(); db.close(); });

describe('poll vote order on one device', () => {
  it('counts up from 1 and stores the last value', async () => {
    expect([await nextVoteSeq('dev_a'), await nextVoteSeq('dev_a'), await nextVoteSeq('dev_a')]).toEqual([1, 2, 3]);
    expect(await getState('poll_vote_seq')).toBe('3');
  });

  it('gives concurrent votes distinct, increasing numbers', async () => {
    const seqs = await Promise.all(Array.from({ length: 5 }, () => nextVoteSeq('dev_a')));
    expect([...seqs].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(await getState('poll_vote_seq')).toBe('5');
  });

  it('continues after a restart, even when the clock went backward', async () => {
    await nextVoteSeq('dev_a'); await nextVoteSeq('dev_a');
    resetVoteSeqCache();
    vi.useFakeTimers(); vi.setSystemTime(new Date('2001-01-01T00:00:00Z'));
    expect(await nextVoteSeq('dev_a')).toBe(3);
  });

  it('re-reads the stored counter when the device id changes (another account\'s database)', async () => {
    await nextVoteSeq('dev_a');
    await db.run(`INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES ('poll_vote_seq', '40', 0)`);
    expect(await nextVoteSeq('dev_b')).toBe(41);
  });
});
