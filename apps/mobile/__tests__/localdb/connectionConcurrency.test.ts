import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqlJsDb, type CountingDb } from '../support/sqljsDb';

let engine: CountingDb;
let opens = 0;
// Match expo-sqlite's actual BEGIN/task/COMMIT/ROLLBACK implementation. In
// particular, a second concurrent BEGIN must NOT silently join the first.
vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => {
    opens++;
    return {
      runAsync: (sql: string, params: any[]) => engine.run(sql, params),
      getAllAsync: (sql: string, params: any[]) => engine.all(sql, params),
      getFirstAsync: (sql: string, params: any[]) => engine.first(sql, params),
      execAsync: (sql: string) => engine.exec(sql),
      closeAsync: async () => {},
      withTransactionAsync: async (fn: () => Promise<void>) => {
        try { await engine.exec('BEGIN'); await fn(); await engine.exec('COMMIT'); }
        catch (error) { await engine.exec('ROLLBACK'); throw error; }
      },
    };
  },
}));

import { openForUser, closeDb } from '../../src/localdb/connection';
import * as messagesRepo from '../../src/localdb/repositories/messagesRepo';
import * as conversationsRepo from '../../src/localdb/repositories/conversationsRepo';

beforeEach(async () => {
  opens = 0;
  engine = await createSqlJsDb();
  await engine.exec('CREATE TABLE concurrent_writes (id TEXT PRIMARY KEY)');
});
afterEach(async () => { await closeDb(); engine.close(); });

describe('native SQLite concurrency', () => {
  it('stores real repository batches arriving together without losing or duplicating messages', async () => {
    await openForUser('u_me');
    const message = (id: string) => ({ remoteId: id, conversationId: 'c', senderUid: 'peer', text: id, remoteCreatedAt: 1 });
    await Promise.all([
      messagesRepo.applyRemoteMessages([message('first'), message('shared')]),
      conversationsRepo.applyRemoteConversations([{ id: 'c', title: 'Group' }]),
      messagesRepo.applyRemoteMessages([message('shared'), message('last')]),
    ]);
    expect((await messagesRepo.listMessages('c')).map(m => m.id).sort()).toEqual(['first', 'last', 'shared']);
    expect((await conversationsRepo.getConversation('c'))?.title).toBe('Group');
  });

  it('commits overlapping feeder, catch-up and notification transactions independently', async () => {
    const db = await openForUser('u_me');
    const results = await Promise.allSettled(['feed', 'pull', 'push'].map(id =>
      db.transaction(async (tx = db) => {
        await tx.run('INSERT INTO concurrent_writes VALUES (?)', [id]);
        await Promise.resolve();
      }),
    ));
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    expect(await db.all('SELECT id FROM concurrent_writes ORDER BY id'))
      .toEqual([{ id: 'feed' }, { id: 'pull' }, { id: 'push' }]);
  });

  it('does not roll back an unrelated write when a batch rejects', async () => {
    const db = await openForUser('u_me');
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(r => { entered = r; });
    const gate = new Promise<void>(r => { release = r; });
    const batch = db.transaction(async (tx = db) => {
      await tx.run('INSERT INTO concurrent_writes VALUES (?)', ['bad-batch']);
      entered(); await gate; throw new Error('rollback this batch');
    });
    const rejected = expect(batch).rejects.toThrow('rollback this batch');
    await started;
    const write = db.run('INSERT INTO concurrent_writes VALUES (?)', ['outgoing']);
    await Promise.resolve(); await Promise.resolve();
    release();
    await rejected; await write;
    expect(await db.all('SELECT id FROM concurrent_writes')).toEqual([{ id: 'outgoing' }]);
  });

  it('opens the user database only once when two screens mount together', async () => {
    const [a, b] = await Promise.all([openForUser('u_me'), openForUser('u_me')]);
    expect(opens).toBe(1);
    expect(a).toBe(b);
  });
});
