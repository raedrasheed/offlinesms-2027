// Firestore rules tests — SMS batches and recipients.
// Client writes denied for both. Sender can read own batch.
//
// Run with: npm run test:rules
// Requires: firebase emulators:start --only firestore

import { afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { addDoc, collection, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { asUser, asAdmin, clearAll, teardownEnv, seed } from '../helpers/rules-helpers';

afterAll(async () => { await teardownEnv(); });
beforeEach(async () => { await clearAll(); });

describe('smsBatches/{batchId}', () => {
  it('sender can read own batch', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'smsBatches', 'b-1'), { senderId: 'u-self', status: 'sending' });
    });
    const db = await asUser('u-self');
    await assertSucceeds(getDoc(doc(db, 'smsBatches', 'b-1')));
  });

  it('non-sender cannot read batch', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'smsBatches', 'b-1'), { senderId: 'u-other', status: 'sending' });
    });
    const db = await asUser('u-self');
    await assertFails(getDoc(doc(db, 'smsBatches', 'b-1')));
  });

  it('admin can read any batch', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'smsBatches', 'b-1'), { senderId: 'u-other', status: 'sending' });
    });
    const db = await asAdmin();
    await assertSucceeds(getDoc(doc(db, 'smsBatches', 'b-1')));
  });

  it('client cannot create or update batch', async () => {
    const db = await asUser('u-self');
    await assertFails(setDoc(doc(db, 'smsBatches', 'b-new'), { senderId: 'u-self' }));
    await assertFails(updateDoc(doc(db, 'smsBatches', 'b-1'), { status: 'sent' }));
  });
});

describe('smsBatches/{batchId}/recipients/{rid}', () => {
  it('client cannot write recipient', async () => {
    const db = await asUser('u-self');
    await assertFails(addDoc(collection(db, 'smsBatches/b-1/recipients'), {
      phone: '+1234567890', status: 'sent',
    }));
  });

  it('admin can write recipient', async () => {
    const db = await asAdmin();
    await assertSucceeds(addDoc(collection(db, 'smsBatches/b-1/recipients'), {
      maskedPhone: '+1•••00', status: 'sent',
    }));
  });
});
