import { beforeEach, expect, it, vi } from 'vitest';
import { BUSINESS, DEVICE, Timestamp, db, num, relayJobs, resetEmulators, seedRelayDevice } from './harness';
import { POST } from '../../apps/dashboard/app/api/v1/org/messages/send/route';
import { generateApiKey } from '../../apps/dashboard/lib/orgMessagingKeys';
import { escalateOrgBatches } from '../src/orgMessaging/escalateOrgBatches';

vi.mock('../src/sms/gateway', () => ({
  sendBatch: () => { throw new Error('The HTTP gateway is disabled in this test'); },
}));

const name = 'Example organization';
const senderUid = `orgsender_${BUSINESS}`;
const key = generateApiKey();
const recipients = [
  { uid: 'recipient-maya', phone: num(1), title: 'Appointment', body: 'Maya, your visit is on Monday.' },
  { uid: 'recipient-omar', phone: num(2), title: 'Order ready', body: 'Omar, collect your order on Tuesday.' },
];

beforeEach(async () => {
  await resetEmulators();
  await seedRelayDevice();

  await Promise.all([
    db().doc(`organizations/${BUSINESS}`).set({
      name, status: 'active', monthlyMessageLimit: 100,
      messagingEscalation: { enabled: true, delayMinutes: 5, audience: 'everyone' },
    }),
    db().doc('organizationApiKeys/example-key').set({ organizationId: BUSINESS, keyHash: key.hash, status: 'active' }),
    db().doc(`organizationRelayAssignments/${BUSINESS}`).set({ relayDeviceId: DEVICE }),
    db().doc(`wallets/${senderUid}`).set({ balance: 500, reserved: 0 }),
    ...recipients.flatMap(({ uid, phone }) => [
      db().doc(`users/${uid}`).set({ phoneVerified: true }),
      db().doc(`users/${uid}/userPrivate/profile`).set({ phoneNumber: phone }),
    ]),
  ]);
});

function send(payload: Record<string, unknown>) {
  return POST(new Request('https://business.offlinesms.com/api/v1/org/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key.raw}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

it('keeps each API message paired with its recipient in the app and Relay queue', async () => {
  const [maya, omar] = recipients;
  const response = await send({
    messages: [
      { phone: maya.phone, title: maya.title, body: maya.body },
      { userId: omar.uid, title: omar.title, body: omar.body },
    ],
  });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result).toMatchObject({ accepted: 2, failed: 0, escalation: { scheduled: true } });

  const rows = await db().collection('organizationMessages').where('batchId', '==', result.batchId).get();
  expect(rows.size).toBe(2);
  expect(new Set(rows.docs.map(row => row.get('conversationId'))).size).toBe(2);
  for (const { uid, title, body } of recipients) {
    const row = rows.docs.find(candidate => candidate.get('resolvedUserId') === uid);
    expect(row?.data()).toMatchObject({ title, body });
    const conversation = db().doc(`conversations/${row!.get('conversationId')}`);
    const [chat, message] = await Promise.all([conversation.get(), conversation.collection('messages').doc(row!.get('messageId')).get()]);
    expect(chat.get('participantUids')).toEqual([senderUid, uid]);
    expect(message.get('text')).toBe(`${title}\n\n${body}`);
  }

  const batch = db().doc(`organizationMessageBatches/${result.batchId}`);
  await batch.update({ escalateAt: Timestamp.fromMillis(Date.now() - 1000) });
  await escalateOrgBatches.run({} as never);

  expect((await batch.get()).data()).toMatchObject({ escalationStatus: 'completed', smsQueued: 2 });
  const jobs = await relayJobs();
  expect(jobs).toHaveLength(2);
  for (const { uid, phone, title, body } of recipients) {
    expect(jobs.find(job => job.get('recipientUid') === uid)?.data()).toMatchObject({
      businessId: BUSINESS, phoneE164: phone, assignedDeviceId: DEVICE, status: 'queued',
      messageBody: `[${name}]\n\n${title}: ${body}`,
    });
  }
});

const recipientGroupName = 'مجموعة الطلبة';

it.each([
  {
    label: 'both names on by default',
    organizationPolicy: null,
    expectedPolicy: { showOrganizationName: true, showRecipientGroupName: true },
    nameLines: [`[${name}]`, `[${recipientGroupName}]`],
    smsEncoding: 'UCS-2', smsSegments: 2, pointsPerRecipient: 56,
  },
  {
    label: 'only the recipient group name',
    organizationPolicy: { showOrganizationName: false },
    expectedPolicy: { showOrganizationName: false, showRecipientGroupName: true },
    nameLines: [`[${recipientGroupName}]`],
    smsEncoding: 'UCS-2', smsSegments: 2, pointsPerRecipient: 56,
  },
  {
    label: 'only the organization name',
    organizationPolicy: { showRecipientGroupName: false },
    expectedPolicy: { showOrganizationName: true, showRecipientGroupName: false },
    nameLines: [`[${name}]`],
    smsEncoding: 'GSM-7', smsSegments: 1, pointsPerRecipient: 28,
  },
  {
    label: 'both names off',
    organizationPolicy: { showOrganizationName: false, showRecipientGroupName: false },
    expectedPolicy: { showOrganizationName: false, showRecipientGroupName: false },
    nameLines: [],
    smsEncoding: 'GSM-7', smsSegments: 1, pointsPerRecipient: 28,
  },
])('honors the submitted group name and SMS settings with $label', async ({
  organizationPolicy, expectedPolicy, nameLines, smsEncoding, smsSegments, pointsPerRecipient,
}) => {
  const recipientGroupId = 'students';
  const title = 'Reminder';
  const body = 'x'.repeat(50);
  const organization = db().doc(`organizations/${BUSINESS}`);
  const group = organization.collection('recipientGroups').doc(recipientGroupId);
  if (organizationPolicy) await organization.update({ smsIdentification: organizationPolicy });
  await Promise.all([
    group.set({
      name: recipientGroupName,
      memberCount: recipients.length,
      members: recipients.map(({ uid, phone }) => ({ name: uid, phone })),
    }),
    db().doc('systemSettings/general').set({ appName: 'OfflineSMS', smsShowAppName: true, smsShowGroupName: false }),
  ]);

  const response = await send({ recipientGroupId, title, body });
  expect(response.status).toBe(200);
  const { batchId, accepted, escalation } = await response.json();
  expect(accepted).toBe(2);
  expect(escalation.scheduled).toBe(true);
  const batch = db().doc(`organizationMessageBatches/${batchId}`);
  expect((await batch.get()).data()).toMatchObject({ recipientGroupName, smsIdentification: expectedPolicy });

  const rows = await db().collection('organizationMessages').where('batchId', '==', batchId).get();
  expect(rows.size).toBe(2);
  for (const row of rows.docs) {
    const message = await db().doc(`conversations/${row.get('conversationId')}/messages/${row.get('messageId')}`).get();
    expect(message.get('text')).toBe(`${title}\n\n${body}`);
  }

  await Promise.all([
    group.update({ name: 'Renamed after submission' }),
    organization.update({
      smsIdentification: {
        showOrganizationName: !expectedPolicy.showOrganizationName,
        showRecipientGroupName: !expectedPolicy.showRecipientGroupName,
      },
    }),
    batch.update({ escalateAt: Timestamp.fromMillis(Date.now() - 1000) }),
  ]);
  await escalateOrgBatches.run({} as never);

  const smsBody = `${['[OfflineSMS]', ...nameLines].join('\n')}\n\n${title}: ${body}`;
  const jobs = await relayJobs();
  expect(jobs).toHaveLength(2);
  for (const { uid, phone } of recipients) {
    expect(jobs.find(job => job.get('recipientUid') === uid)?.data()).toMatchObject({
      phoneE164: phone, assignedDeviceId: DEVICE, status: 'queued', messageBody: smsBody,
    });
  }
  const smsBatches = await db().collection('smsBatches').where('orgBatchId', '==', batchId).get();
  expect(smsBatches.size).toBe(1);
  const pointsReserved = recipients.length * pointsPerRecipient;
  expect(smsBatches.docs[0].data()).toMatchObject({
    smsBody, smsEncoding, smsSegments, pointsPerRecipient, pointsReserved,
  });
  expect((await batch.get()).data()).toMatchObject({
    escalationStatus: 'completed', smsQueued: 2, smsPointsReserved: pointsReserved,
  });
  expect((await db().doc(`wallets/${senderUid}`).get()).data()).toMatchObject({
    balance: 500 - pointsReserved, reserved: pointsReserved,
  });
});
