import { afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { asUser, clearAll, teardownEnv, seed } from '../helpers/rules-helpers';
afterAll(teardownEnv);
beforeEach(async () => {
  await clearAll();
  await seed(async db => {
    await setDoc(doc(db, 'users/peer/groupInvitations/g'), { status: 'pending', conversationId: 'g', inviterUid: 'owner' });
    await setDoc(doc(db, 'conversations/g'), { type: 'group', participantUids: ['owner'] });
    await setDoc(doc(db, 'conversations/g/members/owner'), { role: 'owner', status: 'active' });
    await setDoc(doc(db, 'conversations/g/messages/m'), { text: 'Private media URL', senderUid: 'owner' });
  });
});
describe('private recipient invitations', () => {
  it('allows only recipient to read/list pending invitations, nobody to forge responses', async () => {
    const peer = await asUser('peer'), other = await asUser('other'), owner = await asUser('owner');
    await assertSucceeds(getDoc(doc(peer, 'users/peer/groupInvitations/g')));
    await assertSucceeds(getDocs(query(collection(peer, 'users/peer/groupInvitations'), where('status', '==', 'pending'))));
    await assertFails(getDoc(doc(other, 'users/peer/groupInvitations/g')));
    await assertFails(getDoc(doc(owner, 'users/peer/groupInvitations/g')));
    await assertFails(updateDoc(doc(peer, 'users/peer/groupInvitations/g'), { status: 'accepted' }));
    await assertFails(setDoc(doc(peer, 'conversations/g/members/peer'), { role: 'member', status: 'active' }));
    await assertFails(updateDoc(doc(peer, 'conversations/g'), { participantUids: ['owner','peer'] }));
  });
  it('keeps the group and message URLs private until server-confirmed acceptance', async () => {
    const peer = await asUser('peer');
    await assertFails(getDoc(doc(peer, 'conversations/g')));
    await assertFails(getDoc(doc(peer, 'conversations/g/messages/m')));
    await seed(async db => {
      await updateDoc(doc(db, 'conversations/g'), { participantUids: ['owner','peer'] });
      await setDoc(doc(db, 'conversations/g/members/peer'), { role: 'member', status: 'active' });
    });
    await assertSucceeds(getDoc(doc(peer, 'conversations/g/messages/m')));
  });
});
