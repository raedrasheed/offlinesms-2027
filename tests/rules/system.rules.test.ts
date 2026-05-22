// Firestore rules tests — system-owned collections.
// auditLogs, gatewayHealth, smsDeliveryEvents, smsQuotaUsage,
// transferQuotaUsage. All deny client writes.
//
// Run with: npm run test:rules
// Requires: firebase emulators:start --only firestore

import { afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { addDoc, collection, doc, getDoc, setDoc } from 'firebase/firestore';
import { asUser, asAdmin, clearAll, teardownEnv, seed } from '../helpers/rules-helpers';

afterAll(async () => { await teardownEnv(); });
beforeEach(async () => { await clearAll(); });

describe('auditLogs', () => {
  it('admin can read audit logs', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'auditLogs', 'a-1'), { action: 'test.action', actorUid: 'x' });
    });
    const db = await asAdmin();
    await assertSucceeds(getDoc(doc(db, 'auditLogs', 'a-1')));
  });

  it('regular user cannot read audit logs', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'auditLogs', 'a-1'), { action: 'test.action', actorUid: 'x' });
    });
    const db = await asUser('u-self');
    await assertFails(getDoc(doc(db, 'auditLogs', 'a-1')));
  });

  it('no client (even admin) can write audit logs', async () => {
    const userDb = await asUser('u-self');
    await assertFails(addDoc(collection(userDb, 'auditLogs'), { action: 'fake', actorUid: 'u-self' }));
    const adminDb = await asAdmin();
    await assertFails(addDoc(collection(adminDb, 'auditLogs'), { action: 'fake', actorUid: 'admin-1' }));
  });
});

describe('gatewayHealth', () => {
  it('admin can read gateway health', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'gatewayHealth', 'today'), { lastUpdated: Date.now() });
    });
    const db = await asAdmin();
    await assertSucceeds(getDoc(doc(db, 'gatewayHealth', 'today')));
  });

  it('regular user cannot read gateway health', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'gatewayHealth', 'today'), { lastUpdated: Date.now() });
    });
    const db = await asUser('u-self');
    await assertFails(getDoc(doc(db, 'gatewayHealth', 'today')));
  });

  it('no client can write gateway health', async () => {
    const adminDb = await asAdmin();
    await assertFails(setDoc(doc(adminDb, 'gatewayHealth', 'fake'), { lastUpdated: 0 }));
  });
});

describe('smsDeliveryEvents', () => {
  it('admin can read delivery events', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'smsDeliveryEvents', 'evt-1'), { batchId: 'b', recipient: 'x' });
    });
    const db = await asAdmin();
    await assertSucceeds(getDoc(doc(db, 'smsDeliveryEvents', 'evt-1')));
  });

  it('no client can write delivery events', async () => {
    const adminDb = await asAdmin();
    await assertFails(addDoc(collection(adminDb, 'smsDeliveryEvents'), { batchId: 'b' }));
    const userDb = await asUser('u-self');
    await assertFails(addDoc(collection(userDb, 'smsDeliveryEvents'), { batchId: 'b' }));
  });
});

describe('smsQuotaUsage/{uid}/days/{yyyymmdd}', () => {
  it('self can read own quota usage', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'smsQuotaUsage/u-self/days/20260522'), { count: 3 });
    });
    const db = await asUser('u-self');
    await assertSucceeds(getDoc(doc(db, 'smsQuotaUsage/u-self/days/20260522')));
  });

  it('other user cannot read another user quota', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'smsQuotaUsage/u-other/days/20260522'), { count: 3 });
    });
    const db = await asUser('u-self');
    await assertFails(getDoc(doc(db, 'smsQuotaUsage/u-other/days/20260522')));
  });

  it('no client can write quota usage', async () => {
    const db = await asUser('u-self');
    await assertFails(setDoc(doc(db, 'smsQuotaUsage/u-self/days/20260522'), { count: 999 }));
  });
});

describe('transferQuotaUsage/{uid}/days/{yyyymmdd}', () => {
  it('self can read own transfer quota', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'transferQuotaUsage/u-self/days/20260522'), { count: 1 });
    });
    const db = await asUser('u-self');
    await assertSucceeds(getDoc(doc(db, 'transferQuotaUsage/u-self/days/20260522')));
  });

  it('no client can write transfer quota', async () => {
    const db = await asUser('u-self');
    await assertFails(setDoc(doc(db, 'transferQuotaUsage/u-self/days/20260522'), { count: 999 }));
  });
});
