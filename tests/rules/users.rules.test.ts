// Firestore rules tests — users / profile.
//
// Run with: npm run test:rules
// Requires: firebase emulators:start --only firestore

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
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
describe('users/{uid}/private/profile', () => {
  it('owner can write and read their own private profile', async () => {
    const db = await asUser('u-a');
    await assertSucceeds(setDoc(doc(db, 'users/u-a/private/profile'), {
      phoneNumber: '+970599123456', email: 'a@example.com',
    }));
    await assertSucceeds(getDoc(doc(db, 'users/u-a/private/profile')));
  });

  it('another authed user CANNOT read the private profile', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users/u-a/private/profile'), { phoneNumber: '+970599123456' });
    });
    const db = await asUser('u-b');
    await assertFails(getDoc(doc(db, 'users/u-a/private/profile')));
  });

  it('another authed user CANNOT write the private profile', async () => {
    const db = await asUser('u-b');
    await assertFails(setDoc(doc(db, 'users/u-a/private/profile'), { phoneNumber: '+970599000000' }));
  });

  it('unauthed cannot read the private profile', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users/u-a/private/profile'), { email: 'a@example.com' });
    });
    const db = await asAnon();
    await assertFails(getDoc(doc(db, 'users/u-a/private/profile')));
  });

  it('admin can read and write any private profile', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users/u-a/private/profile'), { phoneNumber: '+970599123456' });
    });
    const db = await asAdmin();
    await assertSucceeds(getDoc(doc(db, 'users/u-a/private/profile')));
    await assertSucceeds(setDoc(doc(db, 'users/u-a/private/profile'), { email: 'x@example.com' }, { merge: true }));
  });
});
