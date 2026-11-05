import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createSqlJsDb, type CountingDb } from '../support/sqljsDb';
let db: CountingDb;
vi.mock('../../src/localdb/connection', () => ({ getDb: () => db }));
import { stageExternalMemberChange } from '../../src/localdb/externalMemberActions';
import { listExternalMembers, confirmExternalMember } from '../../src/localdb/repositories/externalMembersRepo';
import { enqueue, claimDue, markCompleted, markProcessing, markFailed } from '../../src/localdb/repositories/outboxRepo';
import type { OutboxRow } from '../../src/localdb/types';
const add = { action: 'add' as const, conversationId: 'g', contactId: '972591234567', displayName: 'Phone contact', phoneE164: '+972591234567' };
const remove = { action: 'remove' as const, conversationId: 'g', contactId: add.contactId };
const jobs = () => db.all<OutboxRow>('SELECT * FROM outbox ORDER BY created_at, rowid');
beforeEach(async () => { db = await createSqlJsDb(); });
afterEach(() => db.close());

describe('durable external phone membership', () => {
  it('commits the roster and callable request together and coalesces pending duplicate taps', async () => {
    await stageExternalMemberChange(db, add); await stageExternalMemberChange(db, add);
    expect(await jobs()).toHaveLength(1);
    expect(await listExternalMembers('g')).toMatchObject([{ contactId: add.contactId, pending: true, syncState: 'pending' }]);
    expect(JSON.parse((await jobs())[0].payload_json)).toEqual({ conversationId: 'g', displayName: add.displayName, phoneNumber: add.phoneE164 });
  });
  it('revives a legacy dead add with a fresh retry budget rather than falsely succeeding locally', async () => {
    const legacy = await enqueue({ type: 'add_external_contact_to_group', entityType: 'externalMember', entityId: add.contactId,
      conversationId: 'g', idempotencyKey: `addExternal:g:${add.contactId}`, payload: {} });
    await markFailed(legacy.id, 'not-found', 'old backend absent', 1e12, true);
    await stageExternalMemberChange(db, add);
    expect(await jobs()).toMatchObject([{ id: legacy.id, status: 'pending', attempt_count: 0, last_error_code: null }]);
    expect(await claimDue()).toMatchObject([{ id: legacy.id }]);
  });
  it('does not revive a matching phone in another group', async () => {
    await stageExternalMemberChange(db, { ...add, conversationId: 'other' });
    const other = (await jobs())[0]; await markFailed(other.id, 'permission-denied', 'denied', 1e12, true);
    await stageExternalMemberChange(db, add);
    expect((await jobs()).find(row => row.id === other.id)?.status).toBe('dead');
    expect(await claimDue()).toMatchObject([{ conversation_id: 'g' }]);
  });
  it('does not rewrite a processing request while the worker owns it', async () => {
    await stageExternalMemberChange(db, add); const first = (await jobs())[0]; await markProcessing(first.id);
    await stageExternalMemberChange(db, { ...add, displayName: 'Repeated tap' });
    expect(await jobs()).toMatchObject([{ id: first.id, status: 'processing', payload_json: first.payload_json }]);
  });
  it('creates a fresh add after an old completed add even without an intervening local remove', async () => {
    await stageExternalMemberChange(db, add); const first = (await jobs())[0]; await markCompleted(first.id);
    await stageExternalMemberChange(db, add);
    const all = await jobs(); expect(all).toHaveLength(2);
    expect(all[1].idempotency_key).not.toBe(all[0].idempotency_key);
    expect(await claimDue()).toMatchObject([{ id: all[1].id }]);
  });
  it('preserves add/remove/add cycles and does not let a newer action overtake a backed-off earlier action', async () => {
    await stageExternalMemberChange(db, add); const first = (await jobs())[0]; await markCompleted(first.id);
    await stageExternalMemberChange(db, remove); const deletion = (await jobs())[1];
    await markFailed(deletion.id, 'unavailable', 'network', Date.now() + 60_000);
    await stageExternalMemberChange(db, add);
    expect(await claimDue()).toHaveLength(0);
    expect(await claimDue(Date.now() + 120_000)).toMatchObject([{ id: deletion.id }]);
    await markProcessing(deletion.id); expect(await claimDue(Date.now() + 120_000)).toHaveLength(0);
    await markCompleted(deletion.id);
    const next = await claimDue(Date.now() + 120_000); expect(next).toHaveLength(1);
    expect(next[0].type).toBe('add_external_contact_to_group');
    await confirmExternalMember('g', add.contactId, next[0].id);
    expect(await listExternalMembers('g')).toMatchObject([{ pending: false, syncState: 'synced' }]);
  });
  it('does not let an old confirmation clear the pending flag of a newer add', async () => {
    await stageExternalMemberChange(db, add); const old = (await jobs())[0];
    await stageExternalMemberChange(db, remove); await stageExternalMemberChange(db, add);
    await confirmExternalMember('g', add.contactId, old.id);
    expect(await listExternalMembers('g')).toMatchObject([{ pending: true }]);
  });
  it('does not block independent contacts or ordinary messages behind a failed contact', async () => {
    await stageExternalMemberChange(db, add); const first = (await jobs())[0];
    await markFailed(first.id, 'unavailable', 'retry later', Date.now() + 60_000);
    await stageExternalMemberChange(db, { ...add, contactId: '972591234568', phoneE164: '+972591234568' });
    const message = await enqueue({ type: 'send_message', entityId: 'message', idempotencyKey: 'message', payload: {} });
    const ready = await claimDue(); expect(ready.map(row => row.type)).toEqual(['send_message', 'add_external_contact_to_group']);
    expect(ready[0].id).toBe(message.id);
  });
  it('shows permanent failures and clears the optimistic flag only after a matching server confirmation', async () => {
    await stageExternalMemberChange(db, add); const first = (await jobs())[0];
    await markFailed(first.id, 'permission-denied', 'admins-only', 1e12, true);
    expect(await listExternalMembers('g')).toMatchObject([{ pending: true, syncState: 'failed', syncErrorCode: 'permission-denied' }]);
    await stageExternalMemberChange(db, add); expect(await listExternalMembers('g')).toMatchObject([{ pending: true, syncState: 'pending' }]);
    await confirmExternalMember('g', add.contactId, first.id);
    expect(await listExternalMembers('g')).toMatchObject([{ pending: false, syncState: 'synced' }]);
  });
  it('rolls back the queued request when writing its local roster fails', async () => {
    const broken = { ...db, transaction: async (work: (tx: any) => Promise<void>) => db.transaction(tx => work({ ...tx,
      run: async (sql: string, params: any[]) => { if (sql.includes('INSERT INTO external_members')) throw new Error('disk-full'); await tx.run(sql, params); },
    })) };
    await expect(stageExternalMemberChange(broken, add)).rejects.toThrow('disk-full');
    expect(await listExternalMembers('g')).toHaveLength(0); expect(await jobs()).toHaveLength(0);
  });
});
