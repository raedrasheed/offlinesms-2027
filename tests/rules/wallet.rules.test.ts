// Firestore rules tests — wallets / transactions / payments.
//
// Run with: npm run test:rules
// Requires: firebase emulators:start --only firestore

import { afterAll, beforeEach, afterEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { asUser, asAdmin, clearAll, teardownEnv, seed } from '../helpers/rules-helpers';

afterAll(async () => { await teardownEnv(); });
beforeEach(async () => { await clearAll(); });

describe('wallets/{uid}', () => {
  it('user can read own wallet', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'wallets', 'u-self'), { uid: 'u-self', balance: 100, reserved: 0 });
    });
    const db = await asUser('u-self');
    await assertSucceeds(getDoc(doc(db, 'wallets', 'u-self')));
  });

  it('user cannot read another wallet', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'wallets', 'u-other'), { uid: 'u-other', balance: 100 });
    });
    const db = await asUser('u-self');
    await assertFails(getDoc(doc(db, 'wallets', 'u-other')));
  });

  it('user cannot write own wallet (server-only)', async () => {
    const db = await asUser('u-self');
    await assertFails(setDoc(doc(db, 'wallets', 'u-self'), { uid: 'u-self', balance: 999 }));
    await assertFails(updateDoc(doc(db, 'wallets', 'u-self'), { balance: 999 }));
  });

  it('admin can read and write any wallet', async () => {
    const db = await asAdmin();
    await assertSucceeds(setDoc(doc(db, 'wallets', 'u-target'), { uid: 'u-target', balance: 50, reserved: 0 }));
    await assertSucceeds(getDoc(doc(db, 'wallets', 'u-target')));
  });
});

describe('transactions/{txId}', () => {
  it('user can read own transaction', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'transactions', 'tx-1'), { userId: 'u-self', amount: 10 });
    });
    const db = await asUser('u-self');
    await assertSucceeds(getDoc(doc(db, 'transactions', 'tx-1')));
  });

  it('user cannot read another user transaction', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'transactions', 'tx-1'), { userId: 'u-other', amount: 10 });
    });
    const db = await asUser('u-self');
    await assertFails(getDoc(doc(db, 'transactions', 'tx-1')));
  });

  it('user cannot write a transaction', async () => {
    const db = await asUser('u-self');
    await assertFails(setDoc(doc(db, 'transactions', 'tx-new'), {
      userId: 'u-self', type: 'purchase', amount: 1000,
    }));
  });
});

describe('payments/{paymentId}', () => {
  it('user can read own payment', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'payments', 'p-1'), { userId: 'u-self', status: 'pending' });
    });
    const db = await asUser('u-self');
    await assertSucceeds(getDoc(doc(db, 'payments', 'p-1')));
  });

  it('user cannot mark a payment completed', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'payments', 'p-1'), { userId: 'u-self', status: 'pending' });
    });
    const db = await asUser('u-self');
    await assertFails(updateDoc(doc(db, 'payments', 'p-1'), { status: 'completed' }));
  });

  it('even admin cannot write payments (server-only by design)', async () => {
    const db = await asAdmin();
    await assertFails(setDoc(doc(db, 'payments', 'p-new'), { userId: 'x', status: 'completed' }));
  });
});

describe('pointsTransfers/{transferId}', () => {
  it('sender can read own transfer', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'pointsTransfers', 't-1'), { fromUserId: 'u-self', toUserId: 'u-other', amount: 5 });
    });
    const db = await asUser('u-self');
    await assertSucceeds(getDoc(doc(db, 'pointsTransfers', 't-1')));
  });

  it('recipient can read transfer', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'pointsTransfers', 't-1'), { fromUserId: 'u-x', toUserId: 'u-self', amount: 5 });
    });
    const db = await asUser('u-self');
    await assertSucceeds(getDoc(doc(db, 'pointsTransfers', 't-1')));
  });

  it('uninvolved party cannot read transfer', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'pointsTransfers', 't-1'), { fromUserId: 'u-a', toUserId: 'u-b', amount: 5 });
    });
    const db = await asUser('u-self');
    await assertFails(getDoc(doc(db, 'pointsTransfers', 't-1')));
  });

  it('no client can write a transfer (server-only)', async () => {
    const db = await asUser('u-self');
    await assertFails(setDoc(doc(db, 'pointsTransfers', 't-new'), {
      fromUserId: 'u-self', toUserId: 'u-other', amount: 5,
    }));
  });
});
