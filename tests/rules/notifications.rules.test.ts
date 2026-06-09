// Firestore rules tests — push device tokens + notification settings.
//
// Run with: npm run test:rules  (requires the Firestore emulator)

import { afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { asUser, clearAll, teardownEnv } from '../helpers/rules-helpers';

afterAll(async () => { await teardownEnv(); });
beforeEach(async () => { await clearAll(); });

describe('users/{uid}/devices/{deviceId}', () => {
  it('a user can write their own device token', async () => {
    const db = await asUser('u1');
    await assertSucceeds(setDoc(doc(db, 'users', 'u1', 'devices', 'd1'), { fcmToken: 't', enabled: true }));
  });
  it('a user cannot write another user’s device token', async () => {
    const db = await asUser('u1');
    await assertFails(setDoc(doc(db, 'users', 'u2', 'devices', 'd1'), { fcmToken: 't', enabled: true }));
  });
  it('a user cannot read another user’s devices', async () => {
    const db = await asUser('u1');
    await assertFails(getDoc(doc(db, 'users', 'u2', 'devices', 'd1')));
  });
});

describe('users/{uid}/notificationSettings/current', () => {
  it('a user can write their own settings', async () => {
    const db = await asUser('u1');
    await assertSucceeds(setDoc(doc(db, 'users', 'u1', 'notificationSettings', 'current'), { enabled: true }));
  });
  it('a user cannot write another user’s settings', async () => {
    const db = await asUser('u1');
    await assertFails(setDoc(doc(db, 'users', 'u2', 'notificationSettings', 'current'), { enabled: false }));
  });
});

describe('users/{uid}/notifications', () => {
  it('a user can read their own feed but cannot write it (server-only)', async () => {
    const db = await asUser('u1');
    await assertSucceeds(getDoc(doc(db, 'users', 'u1', 'notifications', 'n1')));
    await assertFails(setDoc(doc(db, 'users', 'u1', 'notifications', 'n1'), { type: 'x' }));
  });
});
