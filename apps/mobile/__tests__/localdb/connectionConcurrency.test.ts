import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqlJsDb, type CountingDb } from '../support/sqljsDb';
import { firestoreMock, fakeSeed, fakeTs, resetFake } from '../support/fakeFirestore';
vi.mock('firebase/firestore', () => firestoreMock);
vi.mock('firebase/firestore/lite', () => ({ ...firestoreMock, getFirestore: () => ({}) }));
vi.mock('../../src/lib/firebase', () => ({ app: {}, db: {}, auth: { currentUser: { uid: 'u_me' } } }));

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
import { pullMessages, pullMessageById } from '../../src/localdb/sync/firebasePull';
import { onLocalMessagesChanged } from '../../src/localdb/messageChanges';

beforeEach(async () => {
  opens = 0;
  resetFake();
  engine = await createSqlJsDb();
  await engine.exec('CREATE TABLE concurrent_writes (id TEXT PRIMARY KEY)');
});
afterEach(async () => { await closeDb(); engine.close(); });

describe('native SQLite concurrency', () => {
  it('shows a notification target before a 100-message history page finishes writing', async () => {
    await openForUser('u_me');
    for (let i = 0; i < 100; i++) fakeSeed(`conversations/c/messages/history${i}`, {
      senderUid: 'peer', text: `history ${i}`, createdAt: fakeTs(1000 + i),
    });
    fakeSeed('conversations/urgent/messages/target', { senderUid: 'peer', text: 'just arrived', createdAt: fakeTs(2000) });
    let target: Promise<void> | undefined;
    let storedHistoryWhenTargetVisible = 0;
    const stop = onLocalMessagesChanged(c => {
      if (c !== 'c' || target) return;
      target = pullMessageById('urgent', 'target').then(async found => {
        expect(found).toBe(true);
        expect((await messagesRepo.listMessages('urgent'))[0].text).toBe('just arrived');
        storedHistoryWhenTargetVisible = (await messagesRepo.listMessages('c', 100)).length;
      });
    });
    try {
      await pullMessages('c', 100);
      expect(target).toBeDefined();
      await target;
      expect(storedHistoryWhenTargetVisible).toBeGreaterThan(0);
      expect(storedHistoryWhenTargetVisible).toBeLessThan(100);
      expect(await messagesRepo.listMessages('c', 100)).toHaveLength(100);
    } finally { stop(); }
  });

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
