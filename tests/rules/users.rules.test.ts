// Firestore rules tests — users / profile.
//
// Run with: npm run test:rules
// Requires: firebase emulators:start --only firestore

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collectionGroup, query, where, getDocs } from 'firebase/firestore';
import { asUser, asAdmin, asAnon, clearAll, teardownEnv, seed } from '../helpers/rules-helpers';

beforeAll(async () => {
  // First call boots the test env; failures here mean the emulator is not running.
});

afterAll(async () => {
  await teardownEnv();
});

beforeEach(async () => {
  await clearAll();
});

describe('users/{uid}', () => {
  it('any authed user can read another user profile', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users', 'u-target'), { displayName: 'Target' });
    });
    const db = await asUser('u-other');
    await assertSucceeds(getDoc(doc(db, 'users', 'u-target')));
  });

  it('unauthed cannot read user profile', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users', 'u-target'), { displayName: 'Target' });
    });
    const db = await asAnon();
    await assertFails(getDoc(doc(db, 'users', 'u-target')));
  });

  it('user can update own allowed preference fields', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users', 'u-self'), { displayName: 'Me', profileCompleted: true });
    });
    const db = await asUser('u-self');
    await assertSucceeds(updateDoc(doc(db, 'users', 'u-self'), {
      preferredLanguage: 'ar',
      preferredTheme: 'dark',
      inAppNotifications: false,
      timeFormat: '24h',
    }));
  });

  it('user can update own presence (online + lastSeen)', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users', 'u-self'), { displayName: 'Me', profileCompleted: true });
    });
    const db = await asUser('u-self');
    await assertSucceeds(updateDoc(doc(db, 'users', 'u-self'), {
      online: true,
      lastSeen: new Date(),
      updatedAt: new Date(),
    }));
  });

  it('user cannot set role or admin fields on own profile', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users', 'u-self'), { displayName: 'Me' });
    });
    const db = await asUser('u-self');
    await assertFails(updateDoc(doc(db, 'users', 'u-self'), { admin: true }));
    await assertFails(updateDoc(doc(db, 'users', 'u-self'), { role: 'super_admin' }));
  });

  it('user cannot update another user profile', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users', 'u-target'), { displayName: 'Target' });
    });
    const db = await asUser('u-other');
    await assertFails(updateDoc(doc(db, 'users', 'u-target'), { displayName: 'Hacked' }));
  });

  it('admin can update any user profile', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users', 'u-target'), { displayName: 'Target' });
    });
    const db = await asAdmin();
    await assertSucceeds(updateDoc(doc(db, 'users', 'u-target'), { displayName: 'AdminEdit' }));
  });

  it('public user read still works unchanged after F1 (regression)', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users', 'u-target'), { displayName: 'Target', photoURL: null });
    });
    const db = await asUser('u-other');
    await assertSucceeds(getDoc(doc(db, 'users', 'u-target')));
  });
});

// F1 — sensitive PII moved to an owner/admin-only private subdoc.
describe('users/{uid}/userPrivate/profile', () => {
  it('owner can READ their own private profile (backend-written)', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users/u-a/userPrivate/profile'), {
        phoneNumber: '+970599123456', email: 'a@example.com',
      });
    });
    const db = await asUser('u-a');
    await assertSucceeds(getDoc(doc(db, 'users/u-a/userPrivate/profile')));
  });

  // F1 Phase C: phoneNumber/email are backend-only (verified OTP via Admin SDK).
  // The owner must NOT be able to write them, or they could spoof their phone
  // for contact discovery via collectionGroup('userPrivate').
  it('owner CANNOT write phoneNumber or email to own private profile', async () => {
    const db = await asUser('u-a');
    await assertFails(setDoc(doc(db, 'users/u-a/userPrivate/profile'), { phoneNumber: '+970599123456' }));
    await assertFails(setDoc(doc(db, 'users/u-a/userPrivate/profile'), { email: 'a@example.com' }));
  });

  it('another authed user CANNOT read the private profile', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users/u-a/userPrivate/profile'), { phoneNumber: '+970599123456' });
    });
    const db = await asUser('u-b');
    await assertFails(getDoc(doc(db, 'users/u-a/userPrivate/profile')));
  });

  it('another authed user CANNOT write the private profile', async () => {
    const db = await asUser('u-b');
    await assertFails(setDoc(doc(db, 'users/u-a/userPrivate/profile'), { phoneNumber: '+970599000000' }));
  });

  it('unauthed cannot read the private profile', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users/u-a/userPrivate/profile'), { email: 'a@example.com' });
    });
    const db = await asAnon();
    await assertFails(getDoc(doc(db, 'users/u-a/userPrivate/profile')));
  });

  it('admin can read and write any private profile', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users/u-a/userPrivate/profile'), { phoneNumber: '+970599123456' });
    });
    const db = await asAdmin();
    await assertSucceeds(getDoc(doc(db, 'users/u-a/userPrivate/profile')));
    await assertSucceeds(setDoc(doc(db, 'users/u-a/userPrivate/profile'), { email: 'x@example.com' }, { merge: true }));
  });

  // F1 Phase B: PIN moved here (was rules-denied on the public doc). Owner-write.
  it('owner can write PIN fields to own private profile', async () => {
    const db = await asUser('u-a');
    await assertSucceeds(setDoc(doc(db, 'users/u-a/userPrivate/profile'), {
      pinHash: 'abc', pinSalt: 'def', pinSetAt: new Date(),
    }, { merge: true }));
  });

  // The real mobile flow: setPin merges the PIN factor into the profile the OTP
  // backend already created with phone/email. The diff only touches PIN keys.
  it('owner can merge PIN fields into an existing backend-written profile', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users/u-a/userPrivate/profile'), {
        phoneNumber: '+970599123456', email: 'a@example.com',
      });
    });
    const db = await asUser('u-a');
    await assertSucceeds(setDoc(doc(db, 'users/u-a/userPrivate/profile'), {
      pinHash: 'abc', pinSalt: 'def', pinSetAt: new Date(),
    }, { merge: true }));
  });

  // The owner cannot smuggle a phoneNumber change in alongside a PIN write.
  it('owner CANNOT change phoneNumber while writing PIN fields', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users/u-a/userPrivate/profile'), { phoneNumber: '+970599123456' });
    });
    const db = await asUser('u-a');
    await assertFails(setDoc(doc(db, 'users/u-a/userPrivate/profile'), {
      pinHash: 'abc', phoneNumber: '+970599999999',
    }, { merge: true }));
  });

  it('owner CANNOT delete own private profile (admin/server only)', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users/u-a/userPrivate/profile'), { phoneNumber: '+970599123456' });
    });
    const db = await asUser('u-a');
    await assertFails(deleteDoc(doc(db, 'users/u-a/userPrivate/profile')));
  });

  // F1 Phase B: phone discovery uses collectionGroup('userPrivate'), run ONLY by the
  // backend via the Admin SDK (which bypasses rules). From a CLIENT, a
  // collection-group query over private profiles must be denied so no signed-in
  // user can harvest other users' phone numbers. (Firestore does not grant
  // client collection-group reads of these owner-scoped docs to anyone — admin
  // claim or not — which is exactly what we want; the server uses Admin SDK.)
  it('a client CANNOT run a collectionGroup(private) phone query (no harvesting)', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users/u-a/userPrivate/profile'), { phoneNumber: '+970599123456' });
      await setDoc(doc(db, 'users/u-b/userPrivate/profile'), { phoneNumber: '+970599000000' });
    });
    const db = await asUser('u-c');
    await assertFails(getDocs(query(collectionGroup(db, 'userPrivate'), where('phoneNumber', '==', '+970599123456'))));
  });
});
