// Firestore rules tests — emailOtpChallenges (backend-only).
// Email OTP challenge docs hold hashed sign-in codes and must never be readable
// or writable by clients (authenticated or not). Only admin/backend may touch.
//
// Run with: npm run test:rules
// Requires: firebase emulators:start --only firestore

import { afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { asUser, asAdmin, asAnon, clearAll, teardownEnv, seed } from '../helpers/rules-helpers';

afterAll(async () => { await teardownEnv(); });
beforeEach(async () => { await clearAll(); });

const KEY = 'a'.repeat(64); // looks like a sha256 emailKey

describe('emailOtpChallenges', () => {
  it('admin can read and write challenge docs', async () => {
    const db = await asAdmin();
    await assertSucceeds(setDoc(doc(db, 'emailOtpChallenges', KEY), { codeHash: 'x', salt: 'y', attempts: 0 }));
    await assertSucceeds(getDoc(doc(db, 'emailOtpChallenges', KEY)));
  });

  it('anonymous clients cannot read or write', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'emailOtpChallenges', KEY), { codeHash: 'x', salt: 'y', attempts: 0 });
    });
    const db = await asAnon();
    await assertFails(getDoc(doc(db, 'emailOtpChallenges', KEY)));
    await assertFails(setDoc(doc(db, 'emailOtpChallenges', KEY), { attempts: 99 }));
  });

  it('authenticated non-admin users cannot read or write', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'emailOtpChallenges', KEY), { codeHash: 'x', salt: 'y', attempts: 0 });
    });
    const db = await asUser('u-self');
    await assertFails(getDoc(doc(db, 'emailOtpChallenges', KEY)));
    await assertFails(setDoc(doc(db, 'emailOtpChallenges', KEY), { attempts: 99 }));
  });
});
