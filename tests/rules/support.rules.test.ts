// Firestore rules tests — support tickets.
//
// Run with: npm run test:rules
// Requires: firebase emulators:start --only firestore

import { afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { addDoc, collection, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { asUser, asAdmin, clearAll, teardownEnv, seed } from '../helpers/rules-helpers';

afterAll(async () => { await teardownEnv(); });
beforeEach(async () => { await clearAll(); });

describe('tickets/{ticketId}', () => {
  it('user can create own ticket with status=open', async () => {
    const db = await asUser('u-self');
    await assertSucceeds(addDoc(collection(db, 'tickets'), {
      createdBy: 'u-self',
      subject: 'Hi',
      description: 'Help',
      category: 'other',
      status: 'open',
    }));
  });

  it('user cannot create a ticket attributed to someone else', async () => {
    const db = await asUser('u-self');
    await assertFails(addDoc(collection(db, 'tickets'), {
      createdBy: 'u-other',
      subject: 'Forged',
      status: 'open',
    }));
  });

  it('user cannot set assignedTo at creation', async () => {
    const db = await asUser('u-self');
    await assertFails(addDoc(collection(db, 'tickets'), {
      createdBy: 'u-self',
      subject: 'Hi',
      status: 'open',
      assignedTo: 'admin-1',
    }));
  });

  it('user cannot create a ticket with non-open status', async () => {
    const db = await asUser('u-self');
    await assertFails(addDoc(collection(db, 'tickets'), {
      createdBy: 'u-self',
      subject: 'Hi',
      status: 'resolved',
    }));
  });

  it('user can read own ticket', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'tickets', 't-1'), { createdBy: 'u-self', subject: 'Hi', status: 'open' });
    });
    const db = await asUser('u-self');
    await assertSucceeds(getDoc(doc(db, 'tickets', 't-1')));
  });

  it('user cannot read another user ticket', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'tickets', 't-1'), { createdBy: 'u-other', subject: 'Hi', status: 'open' });
    });
    const db = await asUser('u-self');
    await assertFails(getDoc(doc(db, 'tickets', 't-1')));
  });

  it('user cannot update own ticket (admin-only)', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'tickets', 't-1'), { createdBy: 'u-self', subject: 'Hi', status: 'open' });
    });
    const db = await asUser('u-self');
    await assertFails(updateDoc(doc(db, 'tickets', 't-1'), { status: 'resolved' }));
  });

  it('admin can update any ticket', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'tickets', 't-1'), { createdBy: 'u-other', subject: 'Hi', status: 'open' });
    });
    const db = await asAdmin();
    await assertSucceeds(updateDoc(doc(db, 'tickets', 't-1'), { status: 'resolved', assignedTo: 'admin-1' }));
  });
});
