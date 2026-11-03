import { beforeEach, describe, expect, it } from 'vitest';
import { db, req, resetEmulators, seedRelayDevice, BUSINESS } from './harness';
import { getStorage } from 'firebase-admin/storage';
import { createMediaMessage } from '../src/chats/createMediaMessage';
import { finalizeMediaMessage } from '../src/chats/finalizeMediaMessage';
import { escalateSms } from '../src/sms/escalate';
import { createGroup } from '../src/chats/createGroup';
import { addMembers } from '../src/chats/addMembers';
import { respondToGroupInvitation, MAX_GROUP_INVITE_BATCH } from '../src/chats/memberInvitations';
import { createOrUpdateGroupInviteLink, joinGroupByInviteLink, approveGroupJoinRequest } from '../src/chats/groupInvites';
import { addExternalContactToGroup } from '../src/contacts/externalMembers';
import { linkPhoneContactsOnUserWrite } from '../src/contacts/linkPhoneContacts';
import { sendTextMessage } from '../src/chats/sendTextMessage';
import { previewSmsEscalation } from '../src/sms/previewEscalation';
beforeEach(async () => {
  await resetEmulators();
  for (const uid of ['owner','peer','other']) await db().doc(`users/${uid}`).set({ displayName: uid, username: uid, usernameLower: uid, status: 'active' });
});
async function create() { return (await createGroup.run(req('owner', { name: 'Consent', memberUids: ['peer'] }))).conversationId; }
const respond = (uid: string, cid: string, accept: boolean) => respondToGroupInvitation.run(req(uid, { conversationId: cid, accept }));
async function largeGroup() {
  const cid = await create();
  const participants = ['owner', ...Array.from({ length: 299 }, (_, i) => `existing${i}`)];
  const batch = db().batch();
  batch.update(db().doc(`conversations/${cid}`), { participantUids: participants, memberIds: participants, memberCount: participants.length });
  for (const uid of participants.slice(1)) batch.set(db().doc(`conversations/${cid}/members/${uid}`), { uid, role: 'member', status: 'active' });
  await batch.commit();
  return cid;
}
describe('recipient-controlled membership', () => {
  it('creates only the owner; invitation grants no membership, messages or send rights', async () => {
    const cid = await create();
    expect((await db().doc(`conversations/${cid}`).get()).get('participantUids')).toEqual(['owner']);
    expect((await db().doc(`conversations/${cid}/members/peer`).get()).exists).toBe(false);
    expect((await db().doc(`conversations/${cid}/userState/peer`).get()).exists).toBe(false);
    expect((await db().doc(`users/peer/groupInvitations/${cid}`).get()).get('status')).toBe('pending');
    await expect(sendTextMessage.run(req('peer', { conversationId: cid, text: 'No consent' }))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(respond('other', cid, true)).rejects.toMatchObject({ code: 'not-found' });
    await Promise.all([respond('peer', cid, true), respond('peer', cid, true)]);
    expect((await db().doc(`conversations/${cid}`).get()).get('participantUids')).toEqual(['owner','peer']);
    expect((await db().doc(`conversations/${cid}`).get()).get('memberCount')).toBe(2);
    await expect(sendTextMessage.run(req('peer', { conversationId: cid, text: 'Accepted' }))).resolves.toHaveProperty('messageId');
  });
  it('declining is final and repeated invites cannot silently enroll or re-notify', async () => {
    const cid = await create(); await respond('peer', cid, false);
    expect(await addMembers.run(req('owner', { conversationId: cid, memberUids: ['peer'] }))).toEqual({ added: 0, invited: 0 });
    await expect(respond('peer', cid, true)).rejects.toThrow('invitation-closed');
    expect((await db().doc(`conversations/${cid}`).get()).get('memberCount')).toBe(1);
  });
  it('requires an active admin and rechecks the inviter on acceptance', async () => {
    const cid = await create();
    await expect(addMembers.run(req('other', { conversationId: cid, memberUids: ['peer'] }))).rejects.toMatchObject({ code: 'permission-denied' });
    await db().doc(`conversations/${cid}/members/owner`).update({ status: 'left' });
    await expect(respond('peer', cid, true)).rejects.toThrow('invitation-unavailable');
  });
  it('invites and accepts members above the former total cap, including external members', async () => {
    const cid = await largeGroup();
    await db().doc(`conversations/${cid}`).update({ externalMemberCount: 300 });
    expect(await addMembers.run(req('owner', { conversationId: cid, memberUids: ['other'] }))).toEqual({ added: 0, invited: 1 });
    expect((await db().doc(`conversations/${cid}/members/other`).get()).exists).toBe(false);
    await respond('other', cid, true);
    const group = await db().doc(`conversations/${cid}`).get();
    expect(group.get('memberCount')).toBe(301);
    expect(group.get('externalMemberCount')).toBe(300);
    expect(group.get('participantUids')).toContain('other');
    expect((await db().doc(`conversations/${cid}/members/other`).get()).get('status')).toBe('active');
  });
  it.each(['open', 'approval_required'] as const)('joins a group above 256 members using a %s link', async joinMode => {
    const cid = await largeGroup();
    const link = await createOrUpdateGroupInviteLink.run(req('owner', { conversationId: cid, enabled: true, joinMode }));
    const result = await joinGroupByInviteLink.run(req('other', { inviteCode: link.inviteCode }));
    if (joinMode === 'approval_required') {
      expect(result.status).toBe('pending');
      expect((await db().doc(`conversations/${cid}/members/other`).get()).exists).toBe(false);
      await approveGroupJoinRequest.run(req('owner', { conversationId: cid, requestId: 'other' }));
    } else expect(result.status).toBe('joined');
    expect((await db().doc(`conversations/${cid}`).get()).get('memberCount')).toBe(301);
    expect((await db().doc(`conversations/${cid}/members/other`).get()).get('status')).toBe('active');
  });
  it.each(['open', 'approval_required'] as const)('resumes the same %s invitation after completing a missing username', async joinMode => {
    const cid = await create();
    await db().doc('users/other').set({ displayName: 'Other', status: 'active' });
    const link = await createOrUpdateGroupInviteLink.run(req('owner', { conversationId: cid, enabled: true, joinMode }));
    const join = () => joinGroupByInviteLink.run(req('other', { inviteCode: link.inviteCode }));

    await expect(join()).rejects.toMatchObject({
      code: 'failed-precondition', message: 'username-required', details: { reason: 'username-required' },
    });
    expect((await db().doc(`conversations/${cid}/members/other`).get()).exists).toBe(false);
    expect((await db().doc(`conversations/${cid}/joinRequests/other`).get()).exists).toBe(false);
    expect((await db().doc(`conversations/${cid}`).get()).get('participantUids')).toEqual(['owner']);

    await db().doc('users/other').update({ username: 'other', usernameLower: 'other' });
    expect(await join()).toMatchObject({ status: joinMode === 'open' ? 'joined' : 'pending' });
    if (joinMode === 'approval_required') {
      expect((await db().doc(`conversations/${cid}/members/other`).get()).exists).toBe(false);
      await approveGroupJoinRequest.run(req('owner', { conversationId: cid, requestId: 'other' }));
    }
    expect((await db().doc(`conversations/${cid}`).get()).get('memberCount')).toBe(2);
    expect((await db().doc(`conversations/${cid}/members/other`).get()).get('status')).toBe('active');
  });
  it('adds an external SMS recipient to a group already above 256 registered members', async () => {
    const cid = await largeGroup();
    expect(await addExternalContactToGroup.run(req('owner', { conversationId: cid, displayName: 'Phone contact', phoneNumber: '+970599123456' }))).toMatchObject({ added: 1 });
    expect((await db().doc(`conversations/${cid}`).get()).get('memberCount')).toBe(300);
    expect((await db().doc(`conversations/${cid}`).get()).get('externalMemberCount')).toBe(1);
  });
  it('bounds one invitation request before looking up its group or users', async () => {
    await expect(addMembers.run(req('owner', { conversationId: 'missing', memberUids: Array.from({ length: MAX_GROUP_INVITE_BATCH + 1 }, (_, i) => `absent${i}`) })))
      .rejects.toMatchObject({ code: 'invalid-argument', message: 'too-many-recipients-in-request' });
  });
  it.each(['registered', 'phones', 'mixed'] as const)('bounds a %s creation request before recipient lookups', async kind => {
    const members = Array.from({ length: MAX_GROUP_INVITE_BATCH + (kind === 'registered' ? 1 : 0) }, (_, i) => `absent${i}`);
    const external = { displayName: 'Phone', phoneNumber: '+970599123456' };
    await expect(createGroup.run(req('owner', { name: 'Too much work',
      memberUids: kind === 'phones' ? [] : members,
      externalContacts: kind === 'phones' ? Array(MAX_GROUP_INVITE_BATCH + 1).fill(external) : kind === 'mixed' ? [external] : [],
    }))).rejects.toMatchObject({ code: 'invalid-argument', message: 'too-many-recipients-in-request' });
  });
  it('respects blocked recipients', async () => {
    const cid = await create();
    await db().doc('users/other/blockedUsers/owner').set({ blocked: true });
    expect(await addMembers.run(req('owner', { conversationId: cid, memberUids: ['other'] }))).toEqual({ added: 0, invited: 0 });
    await db().doc('users/peer/blockedUsers/owner').set({ blocked: true });
    await expect(respond('peer', cid, true)).rejects.toThrow('invitation-unavailable');
  });
  it('creates a one-recipient SMS chat with no registered recipient and computes its audience', async () => {
    const { conversationId: cid } = await createGroup.run(req('owner', { name: 'Phone', memberUids: [], externalContacts: [{ displayName: 'Phone contact', phoneNumber: '+970599123456' }] }));
    const sent = await sendTextMessage.run(req('owner', { conversationId: cid, text: 'SMS without registration' }));
    await seedRelayDevice();
    await db().doc('smsConfig/providers').set({ default: 'relay', defaultBusinessId: BUSINESS });
    const preview = await previewSmsEscalation.run(req('owner', { conversationId: cid, messageId: sent.messageId, audience: 'everyone' }));
    expect(preview.eligibleCount).toBe(1);
    expect(preview.eligibleRecipients[0].uid).toBe('ext:970599123456');
    expect((await db().doc(`conversations/${cid}`).get()).get('participantUids')).toEqual(['owner']);
    await db().doc('wallets/owner').set({ balance: 1000, reserved: 0 });
    await escalateSms.run(req('owner', { conversationId: cid, messageId: sent.messageId, audience: 'everyone', smsBody: 'SMS without registration' }));
    const jobs = await db().collection('relayJobs').get();
    expect(jobs.size).toBe(1);
    expect(jobs.docs[0].data()).toMatchObject({ phoneE164: '+970599123456', status: 'queued' });
    expect((await db().doc('wallets/owner').get()).get('balance')).toBe(972);
  });
  it('adding an existing account by phone sends an invitation, then acceptance retires its external row', async () => {
    const cid = await create();
    await db().doc('users/other/userPrivate/profile').set({ phoneNumber: '+970599123456' });
    await addExternalContactToGroup.run(req('owner', { conversationId: cid, displayName: 'Other', phoneNumber: '+970599123456' }));
    expect((await db().doc(`users/other/groupInvitations/${cid}`).get()).get('status')).toBe('pending');
    expect((await db().doc(`conversations/${cid}/members/other`).get()).exists).toBe(false);
    await respond('other', cid, true);
    expect((await db().doc(`conversations/${cid}`).get()).get('externalMemberCount')).toBe(0);
    expect((await db().collection(`conversations/${cid}/externalMembers`).get()).empty).toBe(true);
  });
  it('registering a phone links the address book without auto-enrolling in its groups', async () => {
    const { conversationId: cid } = await createGroup.run(req('owner', { name: 'Phone', memberUids: [], externalContacts: [{ displayName: 'New', phoneNumber: '+970599123456' }] }));
    await linkPhoneContactsOnUserWrite.run({ params: { uid: 'other', doc: 'profile' }, data: { before: { data: () => ({}) }, after: { data: () => ({ phoneNumber: '+970599123456' }) } } } as any);
    expect((await db().doc(`users/other/groupInvitations/${cid}`).get()).get('status')).toBe('pending');
    expect((await db().doc(`conversations/${cid}`).get()).get('participantUids')).toEqual(['owner']);
    await respond('other', cid, false);
    await linkPhoneContactsOnUserWrite.run({ params: { uid: 'other', doc: 'profile' }, data: { before: { data: () => ({}) }, after: { data: () => ({ phoneNumber: '+970599123456' }) } } } as any);
    expect((await db().doc(`users/other/groupInvitations/${cid}`).get()).get('status')).toBe('declined');
  });
  it.each(['image', 'video'] as const)('finalizes group %s after recipient acceptance with a usable remote URL', async type => {
    const cid = await create(); await respond('peer', cid, true);
    const bytes = type === 'image' ? Buffer.from([137,80,78,71,13,10,26,10]) : Buffer.from([0,0,0,16,102,116,121,112,109,112,52,50,0,0,0,0]);
    const mimeType = type === 'image' ? 'image/png' : 'video/mp4';
    const reservation = await createMediaMessage.run(req('peer', { conversationId: cid, type, mimeType, sizeBytes: bytes.length, fileName: type === 'image' ? 'photo.png' : 'video.mp4' }));
    const file = getStorage().bucket().file(reservation.storagePath);
    await file.save(bytes, { metadata: { contentType: mimeType } });
    await finalizeMediaMessage.run(req('peer', { conversationId: cid, messageId: reservation.messageId }));
    const saved = (await db().doc(`conversations/${cid}/messages/${reservation.messageId}`).get()).data()!;
    expect(saved.media.uploadStatus).toBe('uploaded');
    expect(saved.media.downloadURL).toContain(encodeURIComponent(reservation.storagePath));
    expect((await file.download())[0]).toEqual(bytes);
    await file.delete();
  });

});
