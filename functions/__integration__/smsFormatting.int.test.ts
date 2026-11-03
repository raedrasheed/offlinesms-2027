import { beforeEach, describe, expect, it } from 'vitest';
import { BUSINESS, db, num, req, resetEmulators, seedRelayDevice, Timestamp } from './harness';
import { previewSmsEscalation } from '../src/sms/previewEscalation';
import { escalateSms } from '../src/sms/escalate';
import { retryFailedSmsRecipients } from '../src/sms/retryFailed';
import { onSmsBatchAccepted } from '../src/sms/onSmsBatchAccepted';
import { settleSmsBatch } from '../src/sms/settlement';
import { reserveSmsBatch } from '../src/sms/reserveBatch';

const args = { conversationId: 'group', messageId: 'message', audience: 'everyone', smsBody: 'x'.repeat(150) };
const wallet = () => db().doc('wallets/sender');
const preview = (uid = 'sender', extra = {}) => previewSmsEscalation.run(req(uid, { ...args, ...extra }));
async function send(extra = {}) {
  const quote = await preview('sender', extra);
  const result = await escalateSms.run(req('sender', { ...args, ...extra, quoteToken: quote.quoteToken }));
  return { quote, result, ref: db().doc(`smsBatches/${result.batchId}`) };
}
async function complete(ref: FirebaseFirestore.DocumentReference, statuses: Record<string, string>) {
  for (const [uid, status] of Object.entries(statuses)) {
    await ref.collection('recipients').doc(uid).update({ smsStatus: status });
    await db().doc(`relayJobs/${ref.id}:${uid}`).update({ status });
  }
  const before = (await ref.get()).data();
  await ref.update({ status: 'completed' });
  const after = (await ref.get()).data();
  const event = { params: { batchId: ref.id }, data: { before: { data: () => before }, after: { data: () => after } } };
  await Promise.all([onSmsBatchAccepted.run(event as never), onSmsBatchAccepted.run(event as never)]);
}
beforeEach(async () => {
  await resetEmulators();
  await seedRelayDevice();
  await db().doc('smsConfig/providers').set({ default: 'relay', defaultBusinessId: BUSINESS });
  await db().doc('systemSettings/general').set({ appName: 'OfflineSMS', smsShowAppName: true, smsShowGroupName: true, smsShowSenderPhone: true });
  for (const [i, uid] of ['sender', 'r1', 'r2'].entries()) {
    await db().doc(`users/${uid}`).set({ displayName: uid, phoneVerified: true });
    await db().doc(`users/${uid}/userPrivate/profile`).set({ phoneNumber: num(i + 1) });
  }
  await wallet().set({ balance: 1000, reserved: 0 });
  await db().doc('conversations/group').set({ type: 'group', name: 'Team', participantUids: ['sender', 'r1', 'r2'] });
  await db().doc('conversations/group/messages/message').set({ senderUid: 'sender', text: args.smsBody });
});

describe('SMS metadata and price consistency', () => {
  it('sends exactly the preview, settles two segments per recipient once, and retries the snapshotted relay body/price', async () => {
    const { quote, result, ref } = await send();
    const expected = `[OfflineSMS]\n[Team]\n${num(1)}\n\n${args.smsBody}`;
    expect(quote).toMatchObject({ finalSmsBody: expected, smsSegments: 2, smsEncoding: 'GSM-7', pointsPerRecipient: 56, pointsCost: 112, eligibleCount: 2 });
    expect((await wallet().get()).data()).toMatchObject({ balance: 888, reserved: 112 });
    expect((await ref.get()).data()).toMatchObject({ smsBody: expected, pointsReserved: 112, pointsPerRecipient: 56, smsPricingVersion: 1, provider: 'relay', organizationId: BUSINESS });
    const jobs = (await db().collection('relayJobs').where('batchId', '==', result.batchId).get()).docs;
    expect(jobs).toHaveLength(2);
    expect(jobs.every(row => row.get('messageBody') === expected)).toBe(true);
    await complete(ref, { r1: 'delivered', r2: 'failed' });
    expect((await wallet().get()).data()).toMatchObject({ balance: 944, reserved: 0 });
    expect((await ref.get()).data()).toMatchObject({ pointsDeducted: 56, pointsRefunded: 56 });
    expect((await db().collection('transactions').where('relatedSmsBatchId', '==', ref.id).get()).size).toBe(4);
    await db().doc('systemSettings/general').set({ smsShowAppName: false, smsShowGroupName: false, smsShowSenderPhone: false });
    const retried = await retryFailedSmsRecipients.run(req('sender', { batchId: ref.id }));
    const retryRef = db().doc(`smsBatches/${retried.batchId}`);
    expect((await retryRef.get()).data()).toMatchObject({ smsBody: expected, pointsReserved: 56, pointsPerRecipient: 56, recipientCount: 1 });
    expect((await db().doc(`relayJobs/${retryRef.id}:r2`).get()).get('messageBody')).toBe(expected);
    expect((await wallet().get()).data()).toMatchObject({ balance: 888, reserved: 56 });
    await complete(retryRef, { r2: 'failed' });
    expect((await wallet().get()).data()).toMatchObject({ balance: 944, reserved: 0 });
  });
  it('rejects changed policy/body/recipient quotes before reserving points', async () => {
    const quote = await preview();
    await db().doc('systemSettings/general').update({ appName: 'Different' });
    await expect(escalateSms.run(req('sender', { ...args, quoteToken: quote.quoteToken }))).rejects.toThrow('sms-quote-changed');
    expect((await wallet().get()).data()).toEqual({ balance: 1000, reserved: 0 });
    expect((await db().collection('smsBatches').get()).empty).toBe(true);
  });
  it('requires explicit new preview for metadata and multipart, but supports old single-part clients', async () => {
    await expect(escalateSms.run(req('sender', args))).rejects.toThrow('sms-preview-required');
    await db().doc('systemSettings/general').set({});
    await expect(escalateSms.run(req('sender', { ...args, smsBody: 'ش'.repeat(71) }))).rejects.toThrow('sms-preview-required');
    await expect(escalateSms.run(req('sender', { ...args, smsBody: 'Hello' }))).resolves.toMatchObject({ pointsCost: 56 });
  });
  it('checks the complete multipart cost against balance before any batch/job', async () => {
    await wallet().set({ balance: 80, reserved: 0 });
    await expect(send()).rejects.toThrow('not-enough-points');
    expect((await wallet().get()).data()).toEqual({ balance: 80, reserved: 0 });
    expect((await db().collection('smsBatches').get()).empty).toBe(true);
    expect((await db().collection('relayJobs').get()).empty).toBe(true);
  });
  it('uses original message sender phone for admin escalation; omits unverified phone and non-group name', async () => {
    await db().doc('conversations/group').update({ participantUids: ['sender', 'r1', 'r2', 'admin'] });
    await db().doc('conversations/group/members/admin').set({ role: 'admin' });
    await db().doc('users/admin').set({ phoneVerified: true });
    await db().doc('users/admin/userPrivate/profile').set({ phoneNumber: num(9) });
    const p = await preview('admin');
    expect(p.finalSmsBody).toContain(num(1));
    expect(p.finalSmsBody).not.toContain(num(9));
    await db().doc('users/sender').update({ phoneVerified: false });
    await db().doc('conversations/group').update({ type: 'direct' });
    const direct = await preview();
    expect(direct.finalSmsBody).toBe(`[OfflineSMS]\n\n${args.smsBody}`);
  });
  it('handles empty editable draft and applies current relay coverage to preview', async () => {
    await db().doc('systemSettings/general').set({});
    const empty = await preview('sender', { smsBody: '' });
    expect(empty).toMatchObject({ finalSmsBody: '', smsSegments: 0, pointsCost: 0, eligibleCount: 2 });
    expect(empty.quoteToken).toBeTruthy();
    await db().doc('smsConfig/providers').set({ default: 'relay' });
    const uncovered = await preview();
    expect(uncovered).toMatchObject({ eligibleCount: 0, excludedCount: 2, pointsCost: 0 });
  });
  it('rolls back reserve and ledger when batch creation fails atomically', async () => {
    const existing = db().doc('smsBatches/existing');
    await existing.set({ status: 'failed' });
    await expect(reserveSmsBatch(db(), 'sender', existing, 112, { status: 'sending' })).rejects.toThrow();
    expect((await wallet().get()).data()).toEqual({ balance: 1000, reserved: 0 });
    expect((await db().doc('transactions/sms_existing_reservation').get()).exists).toBe(false);
  });
  it('does not re-send external recipients already sent for the same source message', async () => {
    await db().doc('conversations/group/externalMembers/ext:970599123456').set({ phoneNumber: '+970599123456', phoneE164: '+970599123456', displayName: 'Phone', status: 'active' });
    const first = await send();
    await first.ref.update({ createdAt: Timestamp.fromMillis(1) });
    const again = await preview();
    expect(again.eligibleCount).toBe(0);
    expect(again.excludedRecipients.every(r => r.skipReason === 'already-sent-for-message')).toBe(true);
  });
  it('writes more than 500 skipped large-group recipients in bounded batches', async () => {
    const missing = Array.from({ length: 510 }, (_, i) => `missing-${i}`);
    await db().doc('conversations/group').update({ participantUids: ['sender', 'r1', 'r2', ...missing] });
    const { quote, ref } = await send();
    expect(quote).toMatchObject({ eligibleCount: 2, excludedCount: 510, pointsCost: 112 });
    expect((await ref.collection('recipients').get()).size).toBe(512);
    expect((await wallet().get()).data()).toMatchObject({ balance: 888, reserved: 112 });
  });
  it('does not let another organization admin retry someone else’s batch', async () => {
    const { ref } = await send();
    await expect(retryFailedSmsRecipients.run(req('unrelated', { batchId: ref.id }, { claims: { role: 'organization_admin', organizationId: 'other' } }))).rejects.toThrow('not-batch-owner');
  });
});

describe('shared settlement compatibility/recovery', () => {
  it('keeps legacy batch cost and settles concurrent trigger deliveries once', async () => {
    const ref = db().doc('smsBatches/legacy');
    await wallet().set({ balance: 944, reserved: 56 });
    await ref.set({ senderId: 'sender', status: 'completed', recipientCount: 2, smsBody: 'ش'.repeat(200) });
    await ref.collection('recipients').doc('r1').set({ smsStatus: 'sent' });
    await ref.collection('recipients').doc('r2').set({ smsStatus: 'failed' });
    await Promise.all([settleSmsBatch(db(), ref.id), settleSmsBatch(db(), ref.id)]);
    expect((await wallet().get()).data()).toMatchObject({ balance: 972, reserved: 0 });
    expect((await ref.get()).data()).toMatchObject({ pointsDeducted: 28, pointsRefunded: 28 });
  });
  it('reaper skips live relay jobs, then bills sent parts and refunds only failed parts', async () => {
    const { ref } = await send();
    expect(await settleSmsBatch(db(), ref.id, true)).toBeNull();
    expect((await wallet().get()).get('reserved')).toBe(112);
    await ref.collection('recipients').doc('r1').update({ smsStatus: 'sent' });
    await ref.collection('recipients').doc('r2').update({ smsStatus: 'failed' });
    await db().doc(`relayJobs/${ref.id}:r1`).update({ status: 'sent' });
    await db().doc(`relayJobs/${ref.id}:r2`).update({ status: 'failed' });
    await settleSmsBatch(db(), ref.id, true);
    await settleSmsBatch(db(), ref.id);
    expect((await wallet().get()).data()).toMatchObject({ balance: 944, reserved: 0 });
    expect((await ref.get()).data()).toMatchObject({ pointsDeducted: 56, pointsRefunded: 56 });
  });
});
