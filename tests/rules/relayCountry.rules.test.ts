// Firestore rules tests — relay country routing fields are backend-only.
// Relay devices and non-admin users must NOT be able to write
// relayDevices.allowedCountryCodes (only admin callables do). This proves the
// "relay app cannot assign itself to countries" security requirement at the
// rules layer (server-side validation lives in setRelayCountries on top).
//
// Run with: npm run test:rules  (requires the Firestore emulator)

import { afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { asUser, asAdmin, clearAll, teardownEnv, seed } from '../helpers/rules-helpers';

afterAll(async () => { await teardownEnv(); });
beforeEach(async () => { await clearAll(); });

const DEVICE = 'dev-1';
const BIZ = 'biz-1';

async function seedDevice() {
  await seed(async db => {
    await doc(db, 'relayDevices', DEVICE); // ensure path
    await (await import('firebase/firestore')).setDoc(doc(db, 'relayDevices', DEVICE), {
      businessId: BIZ, status: 'active', allowedCountryCodes: ['PS'], countryRoutingEnabled: true,
    });
  });
}

describe('relayDevices country fields are not client-writable', () => {
  it('a relay device (relayDevice claim, not admin) cannot change its own allowedCountryCodes', async () => {
    await seedDevice();
    const deviceCtx = await asUser(DEVICE, { relayDevice: true, deviceId: DEVICE, businessId: BIZ });
    await assertFails(updateDoc(doc(deviceCtx, 'relayDevices', DEVICE), { allowedCountryCodes: ['PS', 'IL', 'JO'] }));
  });

  it('an organization_admin cannot directly write the field via the client SDK (must use the callable)', async () => {
    await seedDevice();
    const orgAdmin = await asUser('admin-biz1', { role: 'organization_admin', organizationId: BIZ });
    await assertFails(updateDoc(doc(orgAdmin, 'relayDevices', DEVICE), { allowedCountryCodes: ['JO'] }));
    // …but may read its own business's device.
    await assertSucceeds(getDoc(doc(orgAdmin, 'relayDevices', DEVICE)));
  });

  it('platform admin (admin claim) may write (callables run as admin)', async () => {
    await seedDevice();
    const admin = await asAdmin();
    await assertSucceeds(updateDoc(doc(admin, 'relayDevices', DEVICE), { allowedCountryCodes: ['PS', 'IL'] }));
  });
});
