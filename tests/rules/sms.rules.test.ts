// Firestore rules tests — SMS batches and recipients.
// Client writes denied for both. Sender can read own batch.
//
// Run with: npm run test:rules
// Requires: firebase emulators:start --only firestore

import { afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { addDoc, collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
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
    await assertSucceeds(getDocs(query(collection(db, 'smsBatches'), where('senderId', '==', 'u-self'))));
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
  it('allows the sender to read personal recipients and denies other users', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'smsBatches/b-1'), { senderId: 'u-other', status: 'sending' });
      await setDoc(doc(db, 'smsBatches/b-1/recipients/recipient'), { maskedPhone: '+1•••00' });
    });
    const sender = await asUser('u-other');
    const unrelated = await asUser('u-self');
    await assertSucceeds(getDoc(doc(sender, 'smsBatches/b-1/recipients/recipient')));
    await assertSucceeds(getDocs(collection(sender, 'smsBatches/b-1/recipients')));
    await assertFails(getDoc(doc(unrelated, 'smsBatches/b-1/recipients/recipient')));
    await assertFails(getDocs(collection(unrelated, 'smsBatches/b-1/recipients')));
  });

  it('applies parent access to organization batch recipients and retries', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'smsBatches/b-1'), { senderId: 'orgsender_org-1', organizationId: 'org-1', orgBatchId: 'org-batch' });
      await setDoc(doc(db, 'smsBatches/b-retry'), { senderId: 'u-retry', organizationId: 'org-1', retryOfBatchId: 'b-1' });
      for (const batchId of ['b-1', 'b-retry']) {
        await setDoc(doc(db, `smsBatches/${batchId}/recipients/recipient`), { phoneE164: '+12025550123' });
      }
    });
    const otherOrgAdmin = await asUser('u-other-org', { role: 'organization_admin', organizationId: 'org-2' });
    const sameOrgAdmin = await asUser('u-same-org', { role: 'organization_admin', organizationId: 'org-1' });
    const admin = await asAdmin();
    for (const batchId of ['b-1', 'b-retry']) {
      const recipients = `smsBatches/${batchId}/recipients`;
      await assertFails(getDoc(doc(otherOrgAdmin, recipients, 'recipient')));
      await assertFails(getDocs(collection(otherOrgAdmin, recipients)));
      await assertFails(getDoc(doc(sameOrgAdmin, recipients, 'recipient')));
      await assertSucceeds(getDoc(doc(admin, recipients, 'recipient')));
      await assertSucceeds(getDocs(collection(admin, recipients)));
    }
    const retrySender = await asUser('u-retry', { role: 'organization_admin', organizationId: 'org-1' });
    await assertSucceeds(getDocs(collection(retrySender, 'smsBatches/b-retry/recipients')));
  });

  it('denies reads of recipients with no parent batch', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'smsBatches/b-1/recipients/recipient'), { phoneE164: '+12025550123' });
    });
    const user = await asUser('u-self');
    const admin = await asAdmin();
    await assertFails(getDoc(doc(user, 'smsBatches/b-1/recipients/recipient')));
    await assertFails(getDoc(doc(admin, 'smsBatches/b-1/recipients/recipient')));
  });

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
