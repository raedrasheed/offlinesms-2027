// Firestore rules tests — group invite settings, join requests, invite codes.
//
// Run with: npm run test:rules  (requires the Firestore emulator)

import { afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { asUser, asAdmin, clearAll, teardownEnv, seed } from '../helpers/rules-helpers';

afterAll(async () => { await teardownEnv(); });
beforeEach(async () => { await clearAll(); });

async function seedGroup() {
  await seed(async db => {
    await setDoc(doc(db, 'conversations', 'g1'), { type: 'group', participantUids: ['owner', 'mem'] });
    await setDoc(doc(db, 'conversations', 'g1', 'members', 'owner'), { uid: 'owner', role: 'owner', status: 'active' });
    await setDoc(doc(db, 'conversations', 'g1', 'members', 'mem'),   { uid: 'mem',   role: 'member', status: 'active' });
    await setDoc(doc(db, 'conversations', 'g1', 'inviteSettings', 'current'), { enabled: true, inviteCode: 'ABCDEFGH', joinMode: 'open' });
    await setDoc(doc(db, 'conversations', 'g1', 'joinRequests', 'req1'), { requesterUid: 'req1', status: 'pending' });
    await setDoc(doc(db, 'inviteCodes', 'ABCDEFGH'), { conversationId: 'g1', joinMode: 'open', enabled: true });
  });
}

describe('inviteSettings/current', () => {
  it('a member can read invite settings', async () => {
    await seedGroup();
    await assertSucceeds(getDoc(doc(await asUser('mem'), 'conversations', 'g1', 'inviteSettings', 'current')));
  });
  it('a non-member cannot read invite settings', async () => {
    await seedGroup();
    await assertFails(getDoc(doc(await asUser('stranger'), 'conversations', 'g1', 'inviteSettings', 'current')));
  });
  it('clients cannot write invite settings (server-only)', async () => {
    await seedGroup();
    await assertFails(setDoc(doc(await asUser('owner'), 'conversations', 'g1', 'inviteSettings', 'current'), { enabled: false }));
  });
});

describe('joinRequests', () => {
  it('a requester can read their own request', async () => {
    await seedGroup();
    await assertSucceeds(getDoc(doc(await asUser('req1'), 'conversations', 'g1', 'joinRequests', 'req1')));
  });
  it('a random user cannot read someone else’s request', async () => {
    await seedGroup();
    await assertFails(getDoc(doc(await asUser('nosy'), 'conversations', 'g1', 'joinRequests', 'req1')));
  });
  it('a group admin can read requests', async () => {
    await seedGroup();
    await assertSucceeds(getDoc(doc(await asUser('owner'), 'conversations', 'g1', 'joinRequests', 'req1')));
  });
  it('clients cannot write join requests (server-only)', async () => {
    await seedGroup();
    await assertFails(setDoc(doc(await asUser('owner'), 'conversations', 'g1', 'joinRequests', 'req2'), { requesterUid: 'req2', status: 'approved' }));
  });
});

describe('inviteCodes (locked reverse index)', () => {
  it('clients cannot read the code → group mapping', async () => {
    await seedGroup();
    await assertFails(getDoc(doc(await asUser('mem'), 'inviteCodes', 'ABCDEFGH')));
  });
  it('admin (Admin-SDK-equivalent) can read', async () => {
    await seedGroup();
    await assertSucceeds(getDoc(doc(await asAdmin(), 'inviteCodes', 'ABCDEFGH')));
  });
});
