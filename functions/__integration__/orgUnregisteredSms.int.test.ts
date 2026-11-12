import { beforeEach, expect, it, vi } from 'vitest';
import { getAuth } from 'firebase-admin/auth';
import { POST } from '../../apps/dashboard/app/api/v1/org/messages/send/route';
import { generateApiKey } from '../../apps/dashboard/lib/orgMessagingKeys';
import { escalateOrgBatches } from '../src/orgMessaging/escalateOrgBatches';
import { retryFailedSmsRecipients } from '../src/sms/retryFailed';
import { settleSmsBatch } from '../src/sms/settlement';
import { BUSINESS, DEVICE, Timestamp, db, num, relayJobs, req, resetEmulators, seedRelayDevice } from './harness';

const sendBatch = vi.hoisted(() => vi.fn(() => {
  throw new Error('Only the simulated Relay may receive SMS jobs in this test');
}));
vi.mock('../src/sms/gateway', () => ({ sendBatch }));

const organizationName = 'Example organization';
const groupName = 'مجموعة الطلبة';
const registeredUid = 'registered-recipient';
const registeredPhone = num(1);
const externalPhone = num(2);
const externalUid = `ext:${externalPhone.slice(1)}`;
const senderUid = `orgsender_${BUSINESS}`;
const apiKey = generateApiKey();
const title = 'Test';
const body = 'Service announcement.';
const startingBalance = 500;

const organization = () => db().doc(`organizations/${BUSINESS}`);
const wallet = () => db().doc(`wallets/${senderUid}`);
const batch = (batchId: string) => db().doc(`organizationMessageBatches/${batchId}`);
const rows = (batchId: string) => db().collection('organizationMessages').where('batchId', '==', batchId).get();

beforeEach(async () => {
  sendBatch.mockClear();
  await resetEmulators();
  await seedRelayDevice('PS');
  await getAuth().createUser({ uid: registeredUid, phoneNumber: registeredPhone });
  await Promise.all([
    organization().set({
      name: organizationName, status: 'active', monthlyMessageLimit: 100,
      messagingEscalation: { enabled: true, delayMinutes: 5, audience: 'unread_only' },
    }),
    db().doc('organizationApiKeys/example-key').set({ organizationId: BUSINESS, keyHash: apiKey.hash, status: 'active' }),
    db().doc(`organizationRelayAssignments/${BUSINESS}`).set({ relayDeviceId: DEVICE }),
    db().doc('systemSettings/general').set({ appName: 'OfflineSMS', smsShowAppName: true }),
    wallet().set({ balance: startingBalance, reserved: 0 }),
    db().doc(`users/${registeredUid}`).set({ phoneVerified: true }),
    db().doc(`users/${registeredUid}/userPrivate/profile`).set({ phoneNumber: registeredPhone }),
  ]);
});

function submit(payload: Record<string, unknown>) {
  return POST(new Request('https://business.offlinesms.com/api/v1/org/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey.raw}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, ...payload }),
  }));
}

async function submitBatch(payload: Record<string, unknown>) {
  const response = await submit(payload);
  expect(response.status).toBe(200);
  return response.json();
}

async function runDueBatch(batchId: string) {
  await batch(batchId).update({ escalateAt: Timestamp.fromMillis(Date.now() - 1000) });
  await escalateOrgBatches.run({} as never);
}

async function registerOptedOutPhone(phone: string) {
  const uid = 'newly-registered-recipient';
  await getAuth().createUser({ uid, phoneNumber: phone });
  await Promise.all([
    db().doc(`users/${uid}`).set({ phoneVerified: true, smsOptOut: true }),
    db().doc(`users/${uid}/userPrivate/profile`).set({ phoneNumber: phone }),
  ]);
}

it('sends a mixed saved group via the same SMS batch and charges each complete message once', async () => {
  const longBody = 'x'.repeat(60);
  await organization().collection('recipientGroups').doc('mixed-group').set({
    name: groupName,
    memberCount: 2,
    members: [{ name: 'Registered', phone: registeredPhone }, { name: 'External', phone: externalPhone }],
  });
  await expect(getAuth().getUserByPhoneNumber(externalPhone)).rejects.toMatchObject({ code: 'auth/user-not-found' });

  const result = await submitBatch({ recipientGroupId: 'mixed-group', body: longBody });
  expect(result).toMatchObject({
    status: 'accepted', total: 2, accepted: 2, unsupported: 0, escalation: { scheduled: true },
    smsCoverage: { covered: 2, noRelay: 0 },
  });
  expect(await relayJobs()).toHaveLength(0);
  const messages = await rows(result.batchId);
  expect(messages.size).toBe(2);
  const external = messages.docs.find(row => row.get('recipientValue') === externalPhone);
  const registered = messages.docs.find(row => row.get('recipientValue') === registeredPhone);
  expect(external?.data()).toMatchObject({
    recipientType: 'phone', recipientValue: externalPhone, status: 'queued', smsOnly: true,
    resolvedUserId: null, conversationId: null, messageId: null,
  });
  expect(registered?.data()).toMatchObject({
    resolvedUserId: registeredUid, status: 'queued', conversationId: expect.any(String), messageId: expect.any(String),
  });
  expect(registered?.get('smsOnly')).not.toBe(true);
  expect((await db().doc(`conversations/${registered!.get('conversationId')}/messages/${registered!.get('messageId')}`).get())
    .get('text')).toBe(`${title}\n\n${longBody}`);

  await runDueBatch(result.batchId);

  const smsBody = `[OfflineSMS]\n[${organizationName}]\n[${groupName}]\n\n${title}: ${longBody}`;
  const jobs = await relayJobs();
  expect(jobs).toHaveLength(2);
  for (const [uid, phone] of [[registeredUid, registeredPhone], [externalUid, externalPhone]]) {
    expect(jobs.find(job => job.get('recipientUid') === uid)?.data()).toMatchObject({
      businessId: BUSINESS, phoneE164: phone, assignedDeviceId: DEVICE, status: 'queued', messageBody: smsBody,
    });
  }
  const smsBatches = await db().collection('smsBatches').where('orgBatchId', '==', result.batchId).get();
  expect(smsBatches.size).toBe(1);
  const smsBatch = smsBatches.docs[0];
  expect(smsBatch.data()).toMatchObject({
    smsBody, smsEncoding: 'UCS-2', smsSegments: 2, pointsPerRecipient: 56, recipientCount: 2, pointsReserved: 112,
  });
  const smsOnlyRecipient = await smsBatch.ref.collection('recipients').doc(externalUid).get();
  expect(smsOnlyRecipient.data()).toMatchObject({
    isExternal: true, phoneE164: externalPhone, appReceiptStatus: null, smsStatus: 'queued',
  });
  expect((await external!.ref.get()).data()).toMatchObject({
    status: 'queued', smsEscalation: 'queued', smsBatchId: smsBatch.id, smsOnly: true,
  });
  expect((await batch(result.batchId).get()).data()).toMatchObject({
    escalationStatus: 'completed', smsQueued: 2, smsPointsReserved: 112,
  });
  expect((await wallet().get()).data()).toMatchObject({ balance: startingBalance - 112, reserved: 112 });

  await batch(result.batchId).update({ escalationStatus: 'scheduled' });
  await escalateOrgBatches.run({} as never);
  expect(await relayJobs()).toHaveLength(2);
  expect((await wallet().get()).data()).toMatchObject({ balance: startingBalance - 112, reserved: 112 });
});

it('sends an unregistered manual recipient through an unpinned relay even with the HTTP provider default', async () => {
  await Promise.all([
    db().doc(`organizationRelayAssignments/${BUSINESS}`).delete(),
    db().doc('smsConfig/providers').set({ default: 'http' }),
  ]);
  const result = await submitBatch({ recipients: [{ phone: externalPhone }] });
  expect(result).toMatchObject({
    status: 'accepted', total: 1, accepted: 1, unsupported: 0, escalation: { scheduled: true, audience: 'unread_only' },
  });
  await runDueBatch(result.batchId);
  const jobs = await relayJobs();
  expect(jobs).toHaveLength(1);
  expect(jobs[0].data()).toMatchObject({
    recipientUid: externalUid, phoneE164: externalPhone, assignedDeviceId: DEVICE, status: 'queued',
    messageBody: `[OfflineSMS]\n[${organizationName}]\n\n${title}: ${body}`,
  });
  const smsBatch = await db().doc(`smsBatches/${jobs[0].get('batchId')}`).get();
  expect(smsBatch.get('provider')).toBe('relay');
  expect(sendBatch).not.toHaveBeenCalled();
  expect((await db().collection('conversations').get()).empty).toBe(true);
  expect((await wallet().get()).data()).toMatchObject({ balance: startingBalance - 28, reserved: 28 });
});

it('does not send or charge for an unregistered phone when organization SMS escalation is disabled', async () => {
  await organization().update({ 'messagingEscalation.enabled': false });
  const result = await submitBatch({ recipients: [{ phone: externalPhone }] });
  expect(result).toMatchObject({
    status: 'failed', total: 1, accepted: 0, unsupported: 1, escalation: { scheduled: false },
  });
  expect((await rows(result.batchId)).docs[0].data()).toMatchObject({
    status: 'unsupported_recipient', failureReason: 'sms_escalation_disabled', resolvedUserId: null,
  });
  await escalateOrgBatches.run({} as never);
  expect(await relayJobs()).toHaveLength(0);
  expect((await wallet().get()).data()).toMatchObject({ balance: startingBalance, reserved: 0 });
});

it('reports a country without an eligible relay at submission and does not schedule SMS', async () => {
  const uncoveredPhone = '+12025550101';
  const result = await submitBatch({ recipients: [{ phone: uncoveredPhone }] });
  expect(result).toMatchObject({
    status: 'failed', total: 1, accepted: 0, escalation: { scheduled: false },
    smsCoverage: { covered: 0, noRelay: 1 },
  });
  expect((await rows(result.batchId)).docs[0].data()).toMatchObject({
    status: 'no_relay_for_country', failureReason: 'no_relay_for_country', recipientValue: uncoveredPhone,
  });
  expect(await relayJobs()).toHaveLength(0);
  expect((await wallet().get()).data()).toMatchObject({ balance: startingBalance, reserved: 0 });
});

it('checks relay coverage again before reserving points for an external number', async () => {
  const result = await submitBatch({ recipients: [{ phone: externalPhone }] });
  expect(result.escalation.scheduled).toBe(true);
  await db().doc(`relayDevices/${DEVICE}`).update({ allowedCountryCodes: ['IL'] });
  await runDueBatch(result.batchId);
  expect((await rows(result.batchId)).docs[0].data()).toMatchObject({
    smsEscalation: 'skipped', smsSkipReason: 'no_relay_for_country',
  });
  expect((await batch(result.batchId).get()).data()).toMatchObject({
    escalationStatus: 'completed', smsQueued: 0, smsSkipped: 1,
  });
  expect(await relayJobs()).toHaveLength(0);
  expect((await wallet().get()).data()).toMatchObject({ balance: startingBalance, reserved: 0 });
});

it('does not use the SMS-only path for a phone linked to an opted-out account before dispatch', async () => {
  const result = await submitBatch({ recipients: [{ phone: externalPhone }] });
  expect(result.escalation.scheduled).toBe(true);
  expect((await rows(result.batchId)).docs[0].get('smsOnly')).toBe(true);
  await registerOptedOutPhone(externalPhone);

  await runDueBatch(result.batchId);

  expect((await rows(result.batchId)).docs[0].data()).toMatchObject({
    smsEscalation: 'skipped', smsSkipReason: 'phone_linked_to_user',
  });
  expect((await batch(result.batchId).get()).data()).toMatchObject({
    escalationStatus: 'completed', smsQueued: 0, smsSkipped: 1,
  });
  expect(await relayJobs()).toHaveLength(0);
  expect((await wallet().get()).data()).toMatchObject({ balance: startingBalance, reserved: 0 });
});

it('retries only unlinked external phones with the original Business SMS and organization wallet', async () => {
  const otherPhone = num(3);
  const otherUid = `ext:${otherPhone.slice(1)}`;
  const longBody = 'x'.repeat(60);
  const group = organization().collection('recipientGroups').doc('retry-group');
  await group.set({
    name: groupName, memberCount: 2,
    members: [{ name: 'First', phone: externalPhone }, { name: 'Second', phone: otherPhone }],
  });
  const result = await submitBatch({ recipientGroupId: group.id, body: longBody });
  await runDueBatch(result.batchId);
  const smsBatches = await db().collection('smsBatches').where('orgBatchId', '==', result.batchId).get();
  expect(smsBatches.size).toBe(1);
  const source = smsBatches.docs[0];
  const originalSms = `[OfflineSMS]\n[${organizationName}]\n[${groupName}]\n\n${title}: ${longBody}`;
  expect(source.data()).toMatchObject({ smsBody: originalSms, pointsReserved: 112 });
  const firstJobs = await relayJobs();
  expect(firstJobs).toHaveLength(2);
  await Promise.all([
    ...firstJobs.map(job => job.ref.update({ status: 'failed' })),
    ...[externalUid, otherUid].map(uid => source.ref.collection('recipients').doc(uid).update({ smsStatus: 'failed' })),
  ]);
  expect(await settleSmsBatch(db(), source.id, true)).toMatchObject({ finalStatus: 'failed', refund: 112 });

  await registerOptedOutPhone(externalPhone);
  await Promise.all([
    group.update({ name: 'Renamed group' }),
    organization().update({ name: 'Renamed organization' }),
    db().doc('systemSettings/general').update({ smsShowAppName: false }),
    db().doc('wallets/org-admin').set({ balance: 0, reserved: 0 }),
  ]);
  const admin = req('org-admin', { batchId: source.id }, {
    claims: { role: 'organization_admin', organizationId: BUSINESS },
  });
  const retried = await retryFailedSmsRecipients.run(admin);
  const retry = db().doc(`smsBatches/${retried.batchId}`);
  expect((await retry.get()).data()).toMatchObject({
    retryOfBatchId: source.id, orgBatchId: result.batchId, senderId: senderUid, organizationId: BUSINESS,
    smsBody: originalSms, smsEncoding: 'UCS-2', smsSegments: 2, pointsPerRecipient: 56, pointsReserved: 56,
    recipientCount: 1,
  });
  const retryJobs = (await db().collection('relayJobs').where('batchId', '==', retry.id).get()).docs;
  expect(retryJobs).toHaveLength(1);
  expect(retryJobs[0].data()).toMatchObject({
    businessId: BUSINESS, assignedDeviceId: DEVICE, recipientUid: otherUid, phoneE164: otherPhone, messageBody: originalSms,
  });
  expect((await retry.collection('recipients').doc(externalUid).get()).exists).toBe(false);
  expect((await wallet().get()).data()).toMatchObject({ balance: startingBalance - 56, reserved: 56 });
  expect((await db().doc('wallets/org-admin').get()).data()).toMatchObject({ balance: 0, reserved: 0 });
});

it('does not send or charge twice for a duplicate external phone within one API batch', async () => {
  const result = await submitBatch({ recipients: [{ phone: externalPhone }, { phone: externalPhone }] });
  expect(result.escalation.scheduled).toBe(true);
  await runDueBatch(result.batchId);
  const jobs = await relayJobs();
  expect(jobs).toHaveLength(1);
  expect(jobs[0].get('phoneE164')).toBe(externalPhone);
  expect((await batch(result.batchId).get()).data()).toMatchObject({ smsQueued: 1, smsPointsReserved: 28 });
  expect((await wallet().get()).data()).toMatchObject({ balance: startingBalance - 28, reserved: 28 });
});

it('does not let a Business API key send SMS to another tenant’s saved group', async () => {
  const foreignOrganization = db().doc('organizations/foreign-business');
  await Promise.all([
    foreignOrganization.set({ name: 'Foreign Business', status: 'active' }),
    foreignOrganization.collection('recipientGroups').doc('foreign-group').set({
      name: 'Foreign group', memberCount: 1, members: [{ name: 'External', phone: externalPhone }],
    }),
  ]);
  const response = await submit({ recipientGroupId: 'foreign-group' });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: 'invalid_payload' } });
  expect((await db().collection('organizationMessageBatches').get()).empty).toBe(true);
  expect(await relayJobs()).toHaveLength(0);
  expect((await wallet().get()).data()).toMatchObject({ balance: startingBalance, reserved: 0 });
});
