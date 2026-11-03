import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { db, resetEmulators, Timestamp } from './harness';
const push = vi.hoisted(() => vi.fn(async () => 1));
vi.mock('../src/notifications/send', () => ({ sendPushToUser: push }));
import { onMessageCreate, FANOUT_PAGE_SIZE } from '../src/chats/onMessageCreate';
import { onMessageCreateNotify, NOTIFICATION_CONCURRENCY } from '../src/notifications/onMessageCreateNotify';
import { runMessageRetention } from '../src/chats/messageRetention';
import { DAY_MS } from '../src/chats/messageRetentionPolicy';
import { aggregateReceipt } from '../src/chats/onReceiptWrite';

const members = Array.from({ length: 301 }, (_, i) => `u${i}`);
const group = () => db().doc('conversations/large');
const message = () => group().collection('messages').doc('m');
async function seed() {
  await group().set({ type: 'group', name: 'Large', participantUids: ['sender', ...members] });
  await message().set({ senderUid: 'sender', type: 'text', text: 'hello', createdAt: Timestamp.fromMillis(1000) });
  return { params: { convoId: 'large', msgId: 'm' }, data: await message().get() } as any;
}
beforeEach(async () => { await resetEmulators(); push.mockReset().mockResolvedValue(1); });
afterEach(() => vi.restoreAllMocks());

describe('large group delivery', () => {
  it('bootstraps 601 receipts over bounded resumable pages and reconciles changes behind its cursor', async () => {
    await message().set({ senderUid: 'sender', type: 'text', createdAt: Timestamp.fromMillis(1000) });
    for (let offset = 0; offset < 601; offset += 300) {
      const batch = db().batch();
      for (let i = offset; i < Math.min(offset + 300, 601); i++) {
        batch.set(message().collection('receipts').doc(`u${String(i).padStart(4, '0')}`), { status: 'pending' });
      }
      await batch.commit();
    }
    const original = db().runTransaction.bind(db());
    let calls = 0;
    const interrupted = vi.spyOn(db(), 'runTransaction').mockImplementation((fn: any) => {
      if (++calls === 2) return Promise.reject(new Error('bootstrap interrupted'));
      return original(fn);
    });
    await expect(aggregateReceipt(db(), 'large', 'm', 'u0000')).rejects.toThrow('bootstrap interrupted');
    interrupted.mockRestore();
    expect((await message().collection('receiptContributions').get()).size).toBe(100);
    expect((await message().get()).get('pendingCount')).toBe(100);
    await message().collection('receipts').doc('u0000').update({ status: 'read' });
    await message().collection('receipts').doc('u0001').delete();
    // All receipt events may overlap, including a replay from a page already
    // committed. Their contributions still track exactly one current status.
    await Promise.all([
      aggregateReceipt(db(), 'large', 'm', 'u0000'),
      aggregateReceipt(db(), 'large', 'm', 'u0001'),
      aggregateReceipt(db(), 'large', 'm', 'u0600'),
    ]);
    const result = (await message().get()).data();
    expect(result).toMatchObject({ receiptAggregationVersion: 2, pendingCount: 599, deliveredCount: 1, readCount: 1 });
    expect(result?.receiptBootstrapCursor).toBeUndefined();
    expect((await message().collection('receiptContributions').get()).size).toBe(600);
    await aggregateReceipt(db(), 'large', 'm', 'u0000');
    expect((await message().get()).get('readCount')).toBe(1);
  });

  it('resumes retention across more than 500 members without decrementing a committed page twice', async () => {
    const now = 30 * DAY_MS;
    await db().doc('systemSettings/general').set({ messageRetentionEnabled: true, messageRetentionDays: 14 });
    await group().set({ type: 'group', lastMessage: { messageId: 'fresh' }, lastMessageText: 'fresh' });
    await message().set({ senderUid: 'sender', type: 'text', text: 'old', createdAt: Timestamp.fromMillis(1000), fanoutApplied: true });
    for (let offset = 0; offset < 601; offset += 300) {
      const batch = db().batch();
      for (let i = offset; i < Math.min(offset + 300, 601); i++) {
        batch.set(group().collection('userState').doc(`u${String(i).padStart(4, '0')}`), {
          unreadCount: 2, lastMessageAt: Timestamp.fromMillis(now - DAY_MS), lastMessagePreview: 'fresh',
        });
      }
      await batch.commit();
    }
    const original = db().runTransaction.bind(db());
    let calls = 0;
    const interrupted = vi.spyOn(db(), 'runTransaction').mockImplementation((fn: any) => {
      // Lease, admission, committed first state page, then a failed page.
      if (++calls === 4) return Promise.reject(new Error('cleanup interrupted'));
      return original(fn);
    });
    const deps = { now: () => now, deleteMedia: async () => {} };
    expect(await runMessageRetention(db(), deps)).toMatchObject({ deleted: 0, failed: 1 });
    interrupted.mockRestore();
    const partial = await group().collection('userState').get();
    expect(partial.docs.filter(row => row.get('unreadCount') === 1)).toHaveLength(100);
    expect(partial.docs.filter(row => row.get('unreadCount') === 2)).toHaveLength(501);
    expect((await message().get()).exists).toBe(false);
    expect((await db().collection('messageRetentionJobs').get()).size).toBe(1);
    expect(await runMessageRetention(db(), deps)).toMatchObject({ deleted: 1, failed: 0 });
    const complete = await group().collection('userState').get();
    expect(complete.size).toBe(601);
    expect(complete.docs.every(row => row.get('unreadCount') === 1 && row.get('lastMessagePreview') === 'fresh')).toBe(true);
    expect((await group().get()).get('lastMessage.messageId')).toBe('fresh');
    expect((await db().collection('messageRetentionJobs').get()).empty).toBe(true);
  });

  it('expiry after an interrupted page preserves newer unread counts for recipients never reached', async () => {
    const event = await seed();
    const original = db().runTransaction.bind(db());
    let calls = 0;
    const interrupted = vi.spyOn(db(), 'runTransaction').mockImplementation((fn: any) => {
      if (++calls === 3) return Promise.reject(new Error('stop after 100 recipients'));
      return original(fn);
    });
    await expect(onMessageCreate.run(event)).rejects.toThrow('stop after 100 recipients');
    interrupted.mockRestore();
    const now = 30 * DAY_MS;
    await db().doc('systemSettings/general').set({ messageRetentionEnabled: true, messageRetentionDays: 14 });
    // u0 received old+new; u100 received only the newer message.
    await group().collection('userState').doc('u0').set({ unreadCount: 2, lastMessageAt: Timestamp.fromMillis(now - DAY_MS) }, { merge: true });
    await group().collection('userState').doc('u100').set({ unreadCount: 1, lastMessageAt: Timestamp.fromMillis(now - DAY_MS) }, { merge: true });
    expect(await runMessageRetention(db(), { now: () => now, deleteMedia: async () => {} })).toMatchObject({ deleted: 1, failed: 0 });
    expect((await group().collection('userState').doc('u0').get()).get('unreadCount')).toBe(1);
    expect((await group().collection('userState').doc('u100').get()).get('unreadCount')).toBe(1);
    expect((await message().collection('fanoutDeliveries').get()).empty).toBe(true);
    expect((await message().collection('fanoutPages').get()).empty).toBe(true);
    await onMessageCreate.run(event);
    expect((await message().get()).exists).toBe(false);
  });

  it('handles 301 recipients and overlapping trigger retries without double unread or receipt regression', async () => {
    const event = await seed();
    await message().collection('receipts').doc('u0').set({ status: 'read' });
    await group().collection('userState').doc('u1').set({ lastReadAt: Timestamp.fromMillis(1500), unreadCount: 0 });
    await Promise.all([onMessageCreate.run(event), onMessageCreate.run(event)]);
    await onMessageCreate.run(event);
    const states = await group().collection('userState').get();
    expect(states.size).toBe(302);
    expect(states.docs.filter(row => row.id !== 'sender' && row.id !== 'u1').every(row => row.get('unreadCount') === 1)).toBe(true);
    expect((await group().collection('userState').doc('u1').get()).get('unreadCount')).toBe(0);
    expect((await message().collection('receipts').get()).size).toBe(301);
    expect((await message().collection('receipts').doc('u0').get()).get('status')).toBe('read');
    expect((await message().collection('fanoutDeliveries').get()).size).toBe(301);
    expect((await message().get()).get('fanoutApplied')).toBe(true);
  });

  it('resumes after a committed page, without re-counting or adding members who joined after the original roster', async () => {
    const event = await seed();
    const original = db().runTransaction.bind(db());
    let calls = 0;
    const interrupted = vi.spyOn(db(), 'runTransaction').mockImplementation((fn: any) => {
      if (++calls === 3) return Promise.reject(new Error('interrupted after page one'));
      return original(fn);
    });
    await expect(onMessageCreate.run(event)).rejects.toThrow('interrupted after page one');
    interrupted.mockRestore();
    expect((await message().get()).get('fanoutApplied')).not.toBe(true);
    expect((await message().collection('fanoutDeliveries').get()).size).toBe(FANOUT_PAGE_SIZE);
    await group().update({ participantUids: ['sender', ...members, 'late-member'] });
    await onMessageCreate.run(event);
    const states = await group().collection('userState').get();
    expect(states.size).toBe(302);
    expect(states.docs.filter(row => row.id !== 'sender').every(row => row.get('unreadCount') === 1)).toBe(true);
    expect((await group().collection('userState').doc('late-member').get()).exists).toBe(false);
    expect((await message().get()).get('fanoutApplied')).toBe(true);
  });

  it('sends push to every eligible recipient with bounded concurrency and preserves completion on retry', async () => {
    const event = await seed();
    await db().doc('users/u0/notificationSettings/current').set({ enabled: false });
    await group().collection('userState').doc('u1').set({ muted: true });
    let running = 0, peak = 0;
    push.mockImplementation(async () => {
      peak = Math.max(peak, ++running);
      await new Promise<void>(resolve => setTimeout(resolve, 1));
      running--; return 1;
    });
    await onMessageCreateNotify.run(event);
    expect(push).toHaveBeenCalledTimes(300);
    expect(push).toHaveBeenCalledWith('u1', expect.objectContaining({ silent: true }));
    expect(peak).toBeLessThanOrEqual(NOTIFICATION_CONCURRENCY);
    expect(running).toBe(0);
    expect((await message().collection('notificationDeliveries').get()).size).toBe(300);
    await onMessageCreateNotify.run(event);
    expect(push).toHaveBeenCalledTimes(300);
  });
});
