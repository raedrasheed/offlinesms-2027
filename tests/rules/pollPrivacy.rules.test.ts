import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { asUser, asAdmin, asAnon, clearAll, teardownEnv, seed } from '../helpers/rules-helpers';

const path = 'conversations/poll-chat/messages/poll';
afterAll(teardownEnv);
beforeEach(async () => {
  await clearAll();
  await seed(async db => {
    await setDoc(doc(db, 'conversations/poll-chat'), { type: 'group', participantUids: ['owner', 'alice', 'bob', 'removed', 'missing'], status: 'active' });
    for (const uid of ['owner', 'alice', 'bob', 'removed']) await setDoc(doc(db, `conversations/poll-chat/members/${uid}`), { role: uid === 'owner' ? 'owner' : 'member', status: uid === 'removed' ? 'removed' : 'active' });
    await setDoc(doc(db, path), { type: 'poll', senderUid: 'owner', poll: { anonymous: true, votes: {}, counts: { o1: 1, o2: 0 }, voterCount: 1 } });
    await setDoc(doc(db, `${path}/pollVoters/alice`), { optionIds: ['o1'], seq: 10 });
  });
});

describe('anonymous ballot access', () => {
  it('allows only the owner to get a ballot, including an absent own ballot', async () => {
    const alice = await asUser('alice');
    expect((await assertSucceeds(getDoc(doc(alice, `${path}/pollVoters/alice`)))).data()?.optionIds).toEqual(['o1']);
    expect((await assertSucceeds(getDoc(doc(await asUser('bob'), `${path}/pollVoters/bob`)))).exists()).toBe(false);
  });
  it('exposes aggregate results to participants without identities', async () => {
    const message = await assertSucceeds(getDoc(doc(await asUser('bob'), path)));
    expect(message.data()?.poll).toEqual({ anonymous: true, votes: {}, counts: { o1: 1, o2: 0 }, voterCount: 1 });
  });
  it.each(['bob', 'owner', 'stranger'])('%s cannot read another voter or enumerate votes', async uid => {
    const db = await asUser(uid);
    await assertFails(getDoc(doc(db, `${path}/pollVoters/alice`)));
    await assertFails(getDocs(collection(db, `${path}/pollVoters`)));
  });
  it('denies even client-admin access to another voter, enumeration, writes, and privacy changes', async () => {
    const db = await asAdmin('owner');
    await assertFails(getDoc(doc(db, `${path}/pollVoters/alice`)));
    await assertFails(getDocs(collection(db, `${path}/pollVoters`)));
    await assertFails(setDoc(doc(db, `${path}/pollVoters/owner`), { optionIds: ['o1'] }));
    await assertFails(updateDoc(doc(db, path), { 'poll.anonymous': false }));
  });
  it('denies ballot collection queries even to the ballot owner', async () => {
    await assertFails(getDocs(collection(await asUser('alice'), `${path}/pollVoters`)));
  });
  it.each(['removed', 'missing', 'stranger'])('denies %s reading even their own ballot', async uid => {
    await assertFails(getDoc(doc(await asUser(uid), `${path}/pollVoters/${uid}`)));
  });
  it('denies unauthenticated reads and all client ballot writes', async () => {
    await assertFails(getDoc(doc(await asAnon(), `${path}/pollVoters/alice`)));
    await assertFails(setDoc(doc(await asUser('alice'), `${path}/pollVoters/alice`), { optionIds: ['o2'] }));
  });
  it.each(['disabled', 'deleted', 'public'])('denies own reads when %s', async state => {
    await seed(async db => {
      if (state === 'disabled') await updateDoc(doc(db, 'conversations/poll-chat'), { status: 'disabled' });
      if (state === 'deleted') await updateDoc(doc(db, path), { deletedForEveryone: true });
      if (state === 'public') await updateDoc(doc(db, path), { 'poll.anonymous': false });
    });
    await assertFails(getDoc(doc(await asUser('alice'), `${path}/pollVoters/alice`)));
  });
});
