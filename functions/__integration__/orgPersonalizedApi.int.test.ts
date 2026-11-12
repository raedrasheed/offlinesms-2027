import { expect, it, vi } from 'vitest';
import { BUSINESS, DEVICE, Timestamp, db, num, relayJobs, resetEmulators, seedRelayDevice } from './harness';
import { POST } from '../../apps/dashboard/app/api/v1/org/messages/send/route';
import { generateApiKey } from '../../apps/dashboard/lib/orgMessagingKeys';
import { escalateOrgBatches } from '../src/orgMessaging/escalateOrgBatches';

vi.mock('../src/sms/gateway', () => ({
  sendBatch: () => { throw new Error('The HTTP gateway is disabled in this test'); },
}));

it('keeps each API message paired with its recipient in the app and Relay queue', async () => {
  await resetEmulators();
  await seedRelayDevice();
  const name = 'Example organization';
  const senderUid = `orgsender_${BUSINESS}`;
  const key = generateApiKey();
  const recipients = [
    { uid: 'recipient-maya', phone: num(1), title: 'Appointment', body: 'Maya, your visit is on Monday.' },
    { uid: 'recipient-omar', phone: num(2), title: 'Order ready', body: 'Omar, collect your order on Tuesday.' },
  ];
  const [maya, omar] = recipients;

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

  const response = await POST(new Request('https://business.offlinesms.com/api/v1/org/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key.raw}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [
      { phone: maya.phone, title: maya.title, body: maya.body },
      { userId: omar.uid, title: omar.title, body: omar.body },
    ] }),
  }));
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
      messageBody: `${name}\n\n${title}: ${body}`,
    });
  }
});
