// Firestore rules tests — relay collections (Phase 24).
// All writes are Admin-SDK only. Reads are business-scoped for relayDevices;
// relayJobs / pairing codes / smsConfig are admin-only.
//
// Run with: npm run test:rules  (requires the Firestore emulator)

import { afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { asUser, asAdmin, clearAll, teardownEnv, seed } from '../helpers/rules-helpers';

const orgAdmin = (biz: string) => asUser(`admin-${biz}`, { role: 'organization_admin', organizationId: biz });

afterAll(async () => { await teardownEnv(); });
beforeEach(async () => { await clearAll(); });

describe('relayDevices/{deviceId}', () => {
  it('org admin can read its own business device', async () => {
    await seed(async db => { await setDoc(doc(db, 'relayDevices', 'd1'), { businessId: 'biz1', status: 'active' }); });
    const db = await orgAdmin('biz1');
    await assertSucceeds(getDoc(doc(db, 'relayDevices', 'd1')));
  });

  it('org admin cannot read another business device', async () => {
    await seed(async db => { await setDoc(doc(db, 'relayDevices', 'd1'), { businessId: 'biz2', status: 'active' }); });
    const db = await orgAdmin('biz1');
    await assertFails(getDoc(doc(db, 'relayDevices', 'd1')));
  });

  it('platform admin can read any device', async () => {
    await seed(async db => { await setDoc(doc(db, 'relayDevices', 'd1'), { businessId: 'biz9', status: 'active' }); });
    const db = await asAdmin();
    await assertSucceeds(getDoc(doc(db, 'relayDevices', 'd1')));
  });

  it('clients cannot write a device (Admin SDK only)', async () => {
    await seed(async db => { await setDoc(doc(db, 'relayDevices', 'd1'), { businessId: 'biz1', status: 'active' }); });
    const db = await orgAdmin('biz1');
    await assertFails(setDoc(doc(db, 'relayDevices', 'd-new'), { businessId: 'biz1' }));
    await assertFails(updateDoc(doc(db, 'relayDevices', 'd1'), { status: 'revoked' }));
  });
});

describe('relayJobs / pairing codes / smsConfig (admin-only)', () => {
  it('non-admin cannot read relay jobs', async () => {
    await seed(async db => { await setDoc(doc(db, 'relayJobs', 'biz1:u1'), { businessId: 'biz1', status: 'queued' }); });
    const db = await orgAdmin('biz1');
    await assertFails(getDoc(doc(db, 'relayJobs', 'biz1:u1')));
  });

  it('admin can read relay jobs; clients cannot write', async () => {
    await seed(async db => { await setDoc(doc(db, 'relayJobs', 'biz1:u1'), { businessId: 'biz1', status: 'queued' }); });
    const admin = await asAdmin();
    await assertSucceeds(getDoc(doc(admin, 'relayJobs', 'biz1:u1')));
    const db = await orgAdmin('biz1');
    await assertFails(setDoc(doc(db, 'relayJobs', 'biz1:u2'), { businessId: 'biz1' }));
  });

  it('pairing codes are never client-readable', async () => {
    await seed(async db => { await setDoc(doc(db, 'relayPairingCodes', 'ABCD2345'), { businessId: 'biz1', used: false }); });
    const db = await orgAdmin('biz1');
    await assertFails(getDoc(doc(db, 'relayPairingCodes', 'ABCD2345')));
  });

  it('smsConfig is admin-only', async () => {
    await seed(async db => { await setDoc(doc(db, 'smsConfig', 'providers'), { default: 'http' }); });
    const db = await orgAdmin('biz1');
    await assertFails(getDoc(doc(db, 'smsConfig', 'providers')));
    await assertSucceeds(getDoc(doc(await asAdmin(), 'smsConfig', 'providers')));
  });
});
