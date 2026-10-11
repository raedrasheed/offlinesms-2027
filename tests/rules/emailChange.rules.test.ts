// Firestore rules tests — email add/change state is backend-only (hashed codes,
// change progress, abuse counters). No client may read codes or write any of it.

import { afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { asUser, asAdmin, clearAll, teardownEnv, seed } from '../helpers/rules-helpers';

afterAll(async () => { await teardownEnv(); });
beforeEach(async () => { await clearAll(); });

describe('emailChange collections', () => {
  it('the owner can neither read its challenge nor write any change state', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'emailChangeChallenges', 'u-self'), { codeHash: 'x', salt: 'y' });
      await setDoc(doc(db, 'emailChangeOps', 'u-self'), { stage: 'done' });
    });
    const db = await asUser('u-self');
    await assertFails(getDoc(doc(db, 'emailChangeChallenges', 'u-self')));
    await assertFails(setDoc(doc(db, 'emailChangeChallenges', 'u-self'), { codeHash: 'x', salt: 'y' }));
    await assertFails(getDoc(doc(db, 'emailChangeOps', 'u-self')));
    await assertFails(setDoc(doc(db, 'emailChangeOps', 'u-self'), { stage: 'done', email: 'x@y.z' }));
    await assertFails(setDoc(doc(db, 'emailChangeLimits', 'acct_u-self'), { h: null }));
  });

  it('admins may read progress but never codes, and never write', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'emailChangeChallenges', 'u-1'), { codeHash: 'x', salt: 'y' });
      await setDoc(doc(db, 'emailChangeOps', 'u-1'), { stage: 'done' });
    });
    const db = await asAdmin();
    await assertFails(getDoc(doc(db, 'emailChangeChallenges', 'u-1')));
    await assertSucceeds(getDoc(doc(db, 'emailChangeOps', 'u-1')));
    await assertFails(setDoc(doc(db, 'emailChangeOps', 'u-1'), { stage: 'failed' }));
  });

  it('the Auth-write ledger: no client access; admins read only', async () => {
    await seed(async db => { await setDoc(doc(db, 'emailChangeAuthWrites', 'u-1'), { pending: {} }); });
    const user = await asUser('u-1');
    await assertFails(getDoc(doc(user, 'emailChangeAuthWrites', 'u-1')));
    await assertFails(setDoc(doc(user, 'emailChangeAuthWrites', 'u-1'), { pending: {} }));
    const admin = await asAdmin();
    await assertSucceeds(getDoc(doc(admin, 'emailChangeAuthWrites', 'u-1')));
    await assertFails(setDoc(doc(admin, 'emailChangeAuthWrites', 'u-1'), { pending: {} }));
  });
});
