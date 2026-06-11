// Firestore rules tests — phoneContacts + conversations/{id}/externalMembers.
//
// Run with: npm run test:rules
// Requires: firebase emulators:start --only firestore

import { afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { asUser, asAdmin, clearAll, teardownEnv, seed } from '../helpers/rules-helpers';

afterAll(async () => { await teardownEnv(); });
beforeEach(async () => { await clearAll(); });

describe('phoneContacts/{contactId}', () => {
  it('owner can read their own phone contact', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'phoneContacts', 'c1'), { ownerUid: 'u-a', phoneE164: '+972591234567' });
    });
    const db = await asUser('u-a');
    await assertSucceeds(getDoc(doc(db, 'phoneContacts', 'c1')));
  });

  it('a different user cannot read someone else’s phone contact (cross-org/owner isolation)', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'phoneContacts', 'c1'), { ownerUid: 'u-a', phoneE164: '+972591234567' });
    });
    const db = await asUser('u-b');
    await assertFails(getDoc(doc(db, 'phoneContacts', 'c1')));
  });

  it('clients cannot write phone contacts directly (server-only)', async () => {
    const db = await asUser('u-a');
    await assertFails(setDoc(doc(db, 'phoneContacts', 'c1'), { ownerUid: 'u-a', phoneE164: '+972591234567' }));
  });

  it('admin can read and write', async () => {
    const db = await asAdmin();
    await assertSucceeds(setDoc(doc(db, 'phoneContacts', 'c1'), { ownerUid: 'u-a', phoneE164: '+972591234567' }));
    await assertSucceeds(getDoc(doc(db, 'phoneContacts', 'c1')));
  });
});

describe('conversations/{id}/externalMembers/{contactId}', () => {
  async function seedGroupWithExternal() {
    await seed(async db => {
      await setDoc(doc(db, 'conversations', 'g1'), { type: 'group', participantUids: ['u-a', 'u-b'] });
      await setDoc(doc(db, 'conversations', 'g1', 'members', 'u-a'), { uid: 'u-a', role: 'owner', status: 'active' });
      await setDoc(doc(db, 'conversations', 'g1', 'members', 'u-b'), { uid: 'u-b', role: 'member', status: 'active' });
      await setDoc(doc(db, 'conversations', 'g1', 'externalMembers', 'c1'), {
        contactId: 'c1', displayName: 'Ext', phoneE164: '+972591234567', isRegistered: false,
      });
    });
  }

  it('a group member can read external members', async () => {
    await seedGroupWithExternal();
    const db = await asUser('u-b');
    await assertSucceeds(getDoc(doc(db, 'conversations', 'g1', 'externalMembers', 'c1')));
  });

  it('a non-member cannot read external members', async () => {
    await seedGroupWithExternal();
    const db = await asUser('u-x');
    await assertFails(getDoc(doc(db, 'conversations', 'g1', 'externalMembers', 'c1')));
  });

  it('a group admin cannot write external members directly (server-only)', async () => {
    await seedGroupWithExternal();
    const db = await asUser('u-a'); // owner
    await assertFails(setDoc(doc(db, 'conversations', 'g1', 'externalMembers', 'c2'), {
      contactId: 'c2', displayName: 'Nope', phoneE164: '+972590000000', isRegistered: false,
    }));
    await assertFails(deleteDoc(doc(db, 'conversations', 'g1', 'externalMembers', 'c1')));
  });

  it('admin can write external members', async () => {
    await seedGroupWithExternal();
    const db = await asAdmin();
    await assertSucceeds(setDoc(doc(db, 'conversations', 'g1', 'externalMembers', 'c2'), {
      contactId: 'c2', displayName: 'Ext2', phoneE164: '+972590000000', isRegistered: false,
    }));
  });
});
