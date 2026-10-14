import { getStorage } from 'firebase-admin/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, resetEmulators, Timestamp } from './harness';
import { runMessageRetention } from '../src/chats/messageRetention';
import { DAY_MS } from '../src/chats/messageRetentionPolicy';
import { aggregateReceipt } from '../src/chats/onReceiptWrite';
import { onMessageCreate } from '../src/chats/onMessageCreate';

const NOW = 1_800_000_000_000;
const path = (id: string) => `conversations/c/messages/${id}`;
const deps = () => ({ now: () => NOW, deleteMedia: vi.fn(async (_prefix: string) => {}) });
async function policy(days = 14, enabled = true) {
  await db().doc('systemSettings/general').set({ messageRetentionDays: days, messageRetentionEnabled: enabled });
}
async function message(id: string, days: number, extra = {}) {
  await db().doc(path(id)).set({ type: 'text', text: 'private', senderUid: 'sender', createdAt: Timestamp.fromMillis(NOW - days * DAY_MS), ...extra });
}
beforeEach(async () => { await resetEmulators(); });

describe('cloud message retention', () => {
  it('does nothing before activation and deletes at the exact 14-day boundary once enabled', async () => {
    await message('old', 14); await message('new', 13.99);
    expect(await runMessageRetention(db(), deps())).toMatchObject({ paused: true, deleted: 0 });
    await policy();
    expect(await runMessageRetention(db(), deps())).toMatchObject({ deleted: 1, failed: 0 });
    expect((await db().doc(path('old')).get()).exists).toBe(false);
    expect((await db().doc(path('new')).get()).exists).toBe(true);
  });
  it('uses configurable days and server creation time, including existing edited messages', async () => {
    await message('old', 8, { updatedAt: Timestamp.fromMillis(NOW) }); await message('keep', 6);
    await policy(7);
    expect(await runMessageRetention(db(), deps())).toMatchObject({ deleted: 1 });
    expect((await db().doc(path('keep')).get()).exists).toBe(true);
  });
  it('removes nested data and owned media, and scrubs stale preview/pin without deleting the conversation', async () => {
    await policy(); await message('image', 15, { type: 'image', media: { storagePath: 'unrelated/private' } });
    await db().doc(`${path('image')}/receipts/u`).set({ status: 'read' });
    await db().doc(`${path('image')}/notificationDeliveries/u`).set({ complete: true });
    await db().doc('conversations/c').set({ lastMessage: { messageId: 'image', preview: 'private' }, pinnedMessage: { messageId: 'image' }, lastMessageText: 'private' });
    await db().doc('conversations/c/userState/u').set({ lastMessageAt: Timestamp.fromMillis(NOW - 15 * DAY_MS), lastMessagePreview: 'private', unreadCount: 1 });
    const io = deps();
    expect(await runMessageRetention(db(), io)).toMatchObject({ deleted: 1 });
    expect(io.deleteMedia).toHaveBeenCalledWith('chatMedia/c/sender/image/');
    expect((await db().doc(`${path('image')}/receipts/u`).get()).exists).toBe(false);
    expect((await db().doc(`${path('image')}/notificationDeliveries/u`).get()).exists).toBe(false);
    expect((await db().doc('conversations/c').get()).data()).toMatchObject({ lastMessage: null, pinnedMessage: null, lastMessageText: '' });
    expect((await db().doc('conversations/c/userState/u').get()).data()).toMatchObject({ lastMessagePreview: '', unreadCount: 0 });
  });
  it.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)('deletes real emulator Storage objects only under the expired message prefix', async () => {
    await policy(); await message('storage', 15, { type: 'image' });
    const bucket = getStorage().bucket('demo-offlinesms.appspot.com');
    const owned = bucket.file('chatMedia/c/sender/storage/image-original.jpg');
    const other = bucket.file('chatMedia/c/sender/newer/image-original.jpg');
    await owned.save(Buffer.from('image')); await other.save(Buffer.from('keep'));
    const io = { now: () => NOW, deleteMedia: async (prefix: string) => { await bucket.deleteFiles({ prefix }); } };
    expect(await runMessageRetention(db(), io)).toMatchObject({ deleted: 1 });
    expect((await owned.exists())[0]).toBe(false);
    expect((await other.exists())[0]).toBe(true);
    await other.delete();
  });
  it('resumes a failed media cleanup from the journal without losing its cleanup target', async () => {
    await policy(); await message('photo', 20, { type: 'image' });
    const io = deps(); io.deleteMedia.mockRejectedValueOnce(new Error('storage unavailable'));
    expect(await runMessageRetention(db(), io)).toMatchObject({ deleted: 0, failed: 1 });
    expect((await db().doc(path('photo')).get()).get('retentionDeleting')).toBe(true);
    expect((await db().collection('messageRetentionJobs').get()).size).toBe(1);
    expect(await runMessageRetention(db(), io)).toMatchObject({ deleted: 1, failed: 0 });
    expect((await db().collection('messageRetentionJobs').get()).empty).toBe(true);
  });
  it('pages across deleted cursors, skips non-chat documents and preserves fresh summaries', async () => {
    await policy();
    const batch = db().batch();
    for (let i = 0; i < 205; i++) batch.set(db().doc(path(`m${i}`)), { type: 'text', createdAt: Timestamp.fromMillis(NOW - 15 * DAY_MS) });
    batch.set(db().doc('tickets/t/messages/private'), { createdAt: Timestamp.fromMillis(NOW - 30 * DAY_MS) });
    batch.set(db().doc('conversations/c'), { lastMessage: { messageId: 'fresh' }, lastMessageText: 'fresh' });
    await batch.commit();
    expect(await runMessageRetention(db(), deps(), 1)).toMatchObject({ deleted: 99 });
    expect(await runMessageRetention(db(), deps(), 5)).toMatchObject({ deleted: 106 });
    expect((await db().doc('tickets/t/messages/private').get()).exists).toBe(true);
    expect((await db().doc('conversations/c').get()).get('lastMessageText')).toBe('fresh');
  });
  it('decrements an expired unread once while preserving newer unread messages', async () => {
    await policy(); await message('old', 15); await message('fresh', 1);
    await db().doc('conversations/c').set({ lastMessage: { messageId: 'fresh' } });
    await db().doc('conversations/c/userState/peer').set({ unreadCount: 2, lastMessageAt: Timestamp.fromMillis(NOW - DAY_MS) });
    await runMessageRetention(db(), deps()); await runMessageRetention(db(), deps());
    expect((await db().doc('conversations/c/userState/peer').get()).get('unreadCount')).toBe(1);
  });
  it('rejects invalid policy and overlapping runs, leaving data untouched', async () => {
    await message('old', 20); await policy(0);
    await expect(runMessageRetention(db(), deps())).rejects.toThrow('invalid-message-retention-days');
    await policy(); await db().doc('systemJobs/messageRetention').set({ leaseUntil: NOW + 1000 });
    expect(await runMessageRetention(db(), deps())).toMatchObject({ busy: true });
    expect((await db().doc(path('old')).get()).exists).toBe(true);
  });
});

describe('receipt aggregation and fan-out races', () => {
  it('bootstraps once, reads current statuses for duplicate/out-of-order events, and handles removal', async () => {
    await message('m', 0);
    const ref = db().doc(path('m'));
    await ref.collection('receipts').doc('a').set({ status: 'read' });
    await ref.collection('receipts').doc('b').set({ status: 'pending' });
    await aggregateReceipt(db(), 'c', 'm', 'a');
    expect((await ref.get()).data()).toMatchObject({ deliveredCount: 1, readCount: 1, pendingCount: 1, receiptAggregationVersion: 2 });
    await ref.collection('receipts').doc('b').set({ status: 'read' });
    await Promise.all([aggregateReceipt(db(), 'c', 'm', 'b'), aggregateReceipt(db(), 'c', 'm', 'b'), aggregateReceipt(db(), 'c', 'm', 'a')]);
    expect((await ref.get()).data()).toMatchObject({ deliveredCount: 2, readCount: 2, pendingCount: 0 });
    await ref.collection('receipts').doc('a').delete();
    await aggregateReceipt(db(), 'c', 'm', 'a');
    expect((await ref.get()).data()).toMatchObject({ deliveredCount: 1, readCount: 1 });
    await ref.delete(); await aggregateReceipt(db(), 'c', 'm', 'b');
    expect((await ref.get()).exists).toBe(false);
  });
  it('late message-create fan-out preserves a receipt that arrived first and does not double unread counts', async () => {
    await db().doc('conversations/c').set({ participantUids: ['sender', 'peer'] });
    await message('m', 0); const ref = db().doc(path('m'));
    await ref.collection('receipts').doc('peer').set({ status: 'read' });
    const event = { params: { convoId: 'c', msgId: 'm' }, data: await ref.get() } as any;
    await onMessageCreate.run(event); await onMessageCreate.run(event);
    expect((await ref.collection('receipts').doc('peer').get()).get('status')).toBe('read');
    expect((await db().doc('conversations/c/userState/peer').get()).get('unreadCount')).toBe(1);
    await ref.delete(); await onMessageCreate.run(event);
    expect((await ref.get()).exists).toBe(false);
  });
});
