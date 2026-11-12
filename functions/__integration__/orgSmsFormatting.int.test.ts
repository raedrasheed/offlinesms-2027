import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUSINESS, DEVICE, db, num, resetEmulators, seedRelayDevice, Timestamp } from './harness';

const dispatch = vi.hoisted(() => vi.fn(async (_batchId: string, _body: string, recipients: Array<{ uid: string }>) => ({
  gatewayBatchId: 'test-gateway',
  acceptedRecipientIds: recipients.filter(r => r.uid !== 'failed-recipient').map(r => r.uid),
  rejectedRecipientIds: recipients.filter(r => r.uid === 'failed-recipient').map(r => ({ uid: r.uid, reason: 'test-failure' })),
})));
vi.mock('../src/sms/gateway', () => ({ sendBatch: dispatch }));
import { escalateOrgBatches } from '../src/orgMessaging/escalateOrgBatches';
import { onSmsBatchAccepted } from '../src/sms/onSmsBatchAccepted';
import { settleSmsBatch } from '../src/sms/settlement';

const senderUid = `orgsender_${BUSINESS}`;
const wallet = () => db().doc(`wallets/${senderUid}`);
const sourceBatch = () => db().doc('organizationMessageBatches/org-batch');

async function seed(balance = 1000) {
  await seedRelayDevice();
  await db().doc('smsConfig/providers').set({ default: 'http' });
  await db().doc('systemSettings/general').set({
    appName: 'OfflineSMS', smsShowAppName: true, smsShowGroupName: true, smsShowSenderPhone: true,
  });
  await db().doc(`organizations/${BUSINESS}`).set({ name: 'Organization' });
  await db().doc(`users/${senderUid}`).set({ isOrgSender: true, displayName: 'Previous name' });
  await wallet().set({ balance, reserved: 0 });
  await sourceBatch().set({
    organizationId: BUSINESS, escalation: { audience: 'everyone' },
    escalationStatus: 'scheduled', escalateAt: Timestamp.fromMillis(Date.now() - 1000),
  });
  const rows = [
    { uid: 'short-recipient', body: 'hello' },
    { uid: 'long-recipient', body: 'x'.repeat(150) },
    { uid: 'failed-recipient', body: 'ش'.repeat(60) },
    { uid: 'unicode-recipient', body: 'ش'.repeat(60) },
  ];
  for (const [index, row] of rows.entries()) {
    await db().doc(`users/${row.uid}`).set({ phoneVerified: true });
    await db().doc(`users/${row.uid}/userPrivate/profile`).set({ phoneNumber: num(index + 1) });
    await db().doc(`organizationMessages/${row.uid}`).set({
      batchId: 'org-batch', resolvedUserId: row.uid, conversationId: `direct-${row.uid}`,
      messageId: `message-${row.uid}`, title: 'T', body: row.body, status: 'queued',
    });
  }
}

beforeEach(async () => { await resetEmulators(); dispatch.mockClear(); });
afterEach(() => vi.restoreAllMocks());

describe('organization SMS formatting and segment billing', () => {
  it('reserves each personalized payload, dispatches exactly that text and settles its snapshotted price', async () => {
    await seed();
    await escalateOrgBatches.run({} as never);
    expect((await sourceBatch().get()).get('smsPointsReserved')).toBe(196);
    expect((await wallet().get()).data()).toMatchObject({ balance: 804, reserved: 196 });
    const batches = (await db().collection('smsBatches').get()).docs;
    expect(batches).toHaveLength(3);
    const byEncodingAndCount = batches.map(batch => ({
      text: batch.get('smsBody'), encoding: batch.get('smsEncoding'),
      segments: batch.get('smsSegments'), unit: batch.get('pointsPerRecipient'),
      recipients: batch.get('recipientCount'), reserved: batch.get('pointsReserved'),
    }));
    expect(byEncodingAndCount).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: '[OfflineSMS]\nOrganization\n\nT: hello', encoding: 'GSM-7', segments: 1, unit: 28, recipients: 1, reserved: 28 }),
      expect.objectContaining({ text: `[OfflineSMS]\nOrganization\n\nT: ${'x'.repeat(150)}`, encoding: 'GSM-7', segments: 2, unit: 56, recipients: 1, reserved: 56 }),
      expect.objectContaining({ text: `[OfflineSMS]\nOrganization\n\nT: ${'ش'.repeat(60)}`, encoding: 'UCS-2', segments: 2, unit: 56, recipients: 2, reserved: 112 }),
    ]));
    expect(dispatch).toHaveBeenCalledTimes(3);
    for (const batch of batches) {
      expect(batch.get('smsPricingVersion')).toBe(1);
      expect(dispatch).toHaveBeenCalledWith(batch.id, batch.get('smsBody'), expect.any(Array));
    }

    // Turning branding off after dispatch must never lower settled charges or
    // the failed recipient's refund: they use the exact queued payload price.
    await db().doc('systemSettings/general').update({ smsShowAppName: false });
    for (const batch of batches) {
      const after = batch.data();
      await onSmsBatchAccepted.run({
        params: { batchId: batch.id },
        data: { before: { data: () => ({ ...after, status: 'sending' }) }, after: { data: () => after } },
      } as never);
    }
    expect((await wallet().get()).data()).toMatchObject({ balance: 860, reserved: 0 });
    const settled = (await db().collection('smsBatches').get()).docs;
    expect(settled.reduce((n, row) => n + row.get('pointsDeducted'), 0)).toBe(140);
    expect(settled.reduce((n, row) => n + row.get('pointsRefunded'), 0)).toBe(56);
    expect((await sourceBatch().get()).get('smsQueued')).toBe(3);
    expect((await sourceBatch().get()).get('smsFailed')).toBe(1);
  });

  it('includes and prices the current Arabic organization name in relay jobs with branding off', async () => {
    await seed();
    const name = 'عائلة رشيد';
    const body = 'x'.repeat(60);
    await db().doc(`organizations/${BUSINESS}`).update({ name });
    await db().doc(`organizationRelayAssignments/${BUSINESS}`).set({ relayDeviceId: DEVICE });
    await db().doc('systemSettings/general').update({ smsShowAppName: false });
    await db().doc('organizationMessages/short-recipient').update({ body });

    await escalateOrgBatches.run({} as never);

    const jobs = await db().collection('relayJobs').where('recipientUid', '==', 'short-recipient').get();
    expect(jobs.size).toBe(1);
    const job = jobs.docs[0];
    const smsBody = `${name}\n\nT: ${body}`;
    expect(job.data()).toMatchObject({ assignedDeviceId: DEVICE, messageBody: smsBody });
    const batch = await db().collection('smsBatches').doc(job.get('batchId')).get();
    expect(batch.data()).toMatchObject({ smsBody, smsEncoding: 'UCS-2', smsSegments: 2, pointsPerRecipient: 56 });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects insufficient balance using complete text pricing before queueing any SMS', async () => {
    // Flat per-recipient pricing would incorrectly permit 4 × 28 = 112.
    await seed(150);
    await escalateOrgBatches.run({} as never);
    expect((await sourceBatch().get()).data()).toMatchObject({
      escalationStatus: 'insufficient_points', smsCostNeeded: 196,
    });
    expect((await wallet().get()).data()).toMatchObject({ balance: 150, reserved: 0 });
    expect((await db().collection('smsBatches').get()).empty).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rolls back the wallet and every child document when reservation is interrupted, then retries once', async () => {
    await seed();
    const original = db().runTransaction.bind(db());
    const interrupted = vi.spyOn(db(), 'runTransaction').mockImplementation((fn: any) => original(async tx => {
      const create = tx.create.bind(tx);
      let children = 0;
      tx.create = ((ref: any, data: any) => {
        if (ref.parent.id === 'smsBatches' && ++children === 2) throw new Error('interrupted before commit');
        return create(ref, data);
      }) as typeof tx.create;
      return fn(tx);
    }));
    await escalateOrgBatches.run({} as never);
    interrupted.mockRestore();
    expect((await wallet().get()).data()).toMatchObject({ balance: 1000, reserved: 0 });
    expect((await db().collection('smsBatches').get()).empty).toBe(true);
    expect((await db().collection('transactions').where('type', '==', 'reservation').get()).empty).toBe(true);
    expect((await sourceBatch().get()).get('smsReservationCommittedAt')).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();

    await sourceBatch().update({ escalationStatus: 'scheduled' });
    await escalateOrgBatches.run({} as never);
    expect((await wallet().get()).data()).toMatchObject({ balance: 804, reserved: 196 });
    expect((await db().collection('smsBatches').get()).size).toBe(3);
    expect((await db().collection('transactions').where('type', '==', 'reservation').get()).size).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(3);
  });

  it('keeps all holds recoverable after a lost commit response and prevents duplicate reservation on replay', async () => {
    await seed();
    const original = db().runTransaction.bind(db());
    const interrupted = vi.spyOn(db(), 'runTransaction').mockImplementation(async (fn: any) => {
      const result = await original(fn);
      if (result === 'reserved') throw new Error('lost response after atomic commit');
      return result;
    });
    await escalateOrgBatches.run({} as never);
    interrupted.mockRestore();
    const batches = (await db().collection('smsBatches').get()).docs;
    expect(batches).toHaveLength(3);
    expect(batches.reduce((sum, row) => sum + row.get('pointsReserved'), 0)).toBe(196);
    for (const batch of batches) {
      expect((await batch.ref.collection('recipients').get()).size).toBe(batch.get('recipientCount'));
    }
    expect((await sourceBatch().get()).get('smsBatchIds').sort()).toEqual(batches.map(b => b.id).sort());
    expect((await wallet().get()).data()).toMatchObject({ balance: 804, reserved: 196 });
    expect(dispatch).not.toHaveBeenCalled();

    // Even an operator requeue after an ambiguous commit cannot reserve or
    // send these messages twice. Recovery settles the recorded child holds.
    await sourceBatch().update({ escalationStatus: 'scheduled' });
    await escalateOrgBatches.run({} as never);
    expect((await wallet().get()).data()).toMatchObject({ balance: 804, reserved: 196 });
    expect((await db().collection('smsBatches').get()).size).toBe(3);
    expect((await db().collection('transactions').where('type', '==', 'reservation').get()).size).toBe(1);
    expect(dispatch).not.toHaveBeenCalled();
    for (const batch of batches) await settleSmsBatch(db(), batch.id, true);
    for (const batch of batches) expect(await settleSmsBatch(db(), batch.id, true)).toBeNull();
    expect((await wallet().get()).data()).toMatchObject({ balance: 1000, reserved: 0 });
  });
});
