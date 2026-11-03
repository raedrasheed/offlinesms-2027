import { afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { asUser, clearAll, seed, teardownEnv } from '../helpers/rules-helpers';

beforeEach(clearAll);
afterAll(teardownEnv);

describe('fixed review uses ordinary account isolation', () => {
  it('reads its own wallet/chat; cannot read another wallet, private profile or chat, or enable review access', async () => {
    await seed(async db => {
      for (const uid of ['demo-review', 'other-user']) {
        await setDoc(doc(db, 'wallets', uid), { balance: 50 });
        await setDoc(doc(db, 'users', uid, 'userPrivate', 'profile'), { email: `${uid}@example.test` });
        await setDoc(doc(db, 'conversations', uid), { type: 'direct', participantUids: [uid, 'peer'], status: 'active' });
      }
    });
    const db = await asUser('demo-review', { demoReview: true });
    await assertSucceeds(getDoc(doc(db, 'wallets', 'demo-review')));
    await assertSucceeds(getDoc(doc(db, 'conversations', 'demo-review')));
    await assertFails(getDoc(doc(db, 'wallets', 'other-user')));
    await assertFails(getDoc(doc(db, 'users', 'other-user', 'userPrivate', 'profile')));
    await assertFails(getDoc(doc(db, 'conversations', 'other-user')));
    await assertFails(setDoc(doc(db, 'smsConfig', 'otp'), { signin: { fixedReview: { enabled: true, uid: 'other-user' } } }));
  });
});
