// Firestore rules tests — phone linking (Phase 1, scenario 10: a client must not
// be able to set or change verified-phone state directly).
//
// Covers: phoneLinkChallenges / phoneClaims / phoneLinkOps / smsRateLimits are
// server-only; users/{uid}.phoneVerified and phoneNumber can't be written by
// the owner (create or update); userPrivate.phoneNumber can't be written by
// the owner; smsConfig/phoneLink (feature + emergency stop) is admin-only.
//
// Run with: npm run test:rules (Firestore emulator on 127.0.0.1:8080)

import { afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { asUser, asAdmin, asAnon, clearAll, teardownEnv, seed } from '../helpers/rules-helpers';

afterAll(async () => { await teardownEnv(); });
beforeEach(async () => { await clearAll(); });

const UID = 'u-self';
const KEY = 'b'.repeat(64);

describe('phone-link server-only collections', () => {
  beforeEach(async () => {
    await seed(async db => {
      await setDoc(doc(db, 'phoneLinkChallenges', UID), { uid: UID, codeVerifier: 'x', attempts: 0, status: 'pending' });
      await setDoc(doc(db, 'phoneClaims', KEY), { uid: 'someone-else', state: 'active' });
      await setDoc(doc(db, 'phoneLinkOps', UID), { uid: UID, stage: 'claimed' });
      await setDoc(doc(db, 'smsRateLimits', `acct_${UID}`), { h: { s: 1, c: 1 } });
    });
  });

  it('the owner cannot read, create, change or delete their own challenge', async () => {
    const db = await asUser(UID);
    await assertFails(getDoc(doc(db, 'phoneLinkChallenges', UID)));
    await assertFails(setDoc(doc(db, 'phoneLinkChallenges', UID), { uid: UID, attempts: 0, status: 'pending' }));
    await assertFails(updateDoc(doc(db, 'phoneLinkChallenges', UID), { attempts: 0 }));
    await assertFails(deleteDoc(doc(db, 'phoneLinkChallenges', UID)));
  });

  it('even an admin client cannot read challenge verifiers', async () => {
    const db = await asAdmin();
    await assertFails(getDoc(doc(db, 'phoneLinkChallenges', UID)));
    await assertFails(setDoc(doc(db, 'phoneLinkChallenges', UID), { status: 'used' }));
  });

  it('clients cannot claim a number or advance/forge link state', async () => {
    const db = await asUser(UID);
    await assertFails(setDoc(doc(db, 'phoneClaims', 'c'.repeat(64)), { uid: UID, state: 'active' }));
    await assertFails(updateDoc(doc(db, 'phoneClaims', KEY), { uid: UID }));
    await assertFails(deleteDoc(doc(db, 'phoneClaims', KEY)));
    await assertFails(getDoc(doc(db, 'phoneClaims', KEY)));
    await assertFails(updateDoc(doc(db, 'phoneLinkOps', UID), { stage: 'done' }));
    await assertFails(getDoc(doc(db, 'phoneLinkOps', UID)));
  });

  it('clients cannot reset their abuse counters', async () => {
    const db = await asUser(UID);
    await assertFails(setDoc(doc(db, 'smsRateLimits', `acct_${UID}`), {}));
    await assertFails(deleteDoc(doc(db, 'smsRateLimits', `acct_${UID}`)));
    await assertFails(setDoc(doc(db, 'smsRateLimits', 'global_phoneLink'), {}));
    await assertFails(getDoc(doc(db, 'smsRateLimits', `acct_${UID}`)));
  });

  it('anonymous clients are refused everywhere', async () => {
    const db = await asAnon();
    await assertFails(getDoc(doc(db, 'phoneClaims', KEY)));
    await assertFails(setDoc(doc(db, 'phoneLinkOps', UID), { stage: 'done' }));
    await assertFails(setDoc(doc(db, 'smsRateLimits', 'global_phoneLink'), {}));
  });

  it('admins may read claims, ops and counters but never write them', async () => {
    const db = await asAdmin();
    await assertSucceeds(getDoc(doc(db, 'phoneClaims', KEY)));
    await assertSucceeds(getDoc(doc(db, 'phoneLinkOps', UID)));
    await assertSucceeds(getDoc(doc(db, 'smsRateLimits', `acct_${UID}`)));
    await assertFails(setDoc(doc(db, 'phoneClaims', KEY), { uid: 'x' }));
    await assertFails(updateDoc(doc(db, 'phoneLinkOps', UID), { stage: 'done' }));
  });
});

describe('verified-phone fields on the user profile', () => {
  it('owner cannot set phoneVerified / phoneNumber on an existing profile', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users', UID), { displayName: 'A', status: 'active', phoneVerified: false });
    });
    const db = await asUser(UID);
    await assertFails(updateDoc(doc(db, 'users', UID), { phoneVerified: true }));
    await assertFails(updateDoc(doc(db, 'users', UID), { phoneNumber: '+970599123456' }));
  });

  it('owner cannot create a profile carrying phone/email/phoneVerified', async () => {
    const db = await asUser(UID);
    await assertFails(setDoc(doc(db, 'users', UID), { displayName: 'A', phoneNumber: '+970599123456' }));
    await assertFails(setDoc(doc(db, 'users', UID), { displayName: 'A', email: 'a@example.com' }));
    await assertFails(setDoc(doc(db, 'users', UID), { displayName: 'A', phoneVerified: true }));
  });

  it('owner cannot write phoneNumber / phoneVerifiedAt into their private profile', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users', UID), { displayName: 'A', status: 'active' });
      await setDoc(doc(db, 'users', UID, 'userPrivate', 'profile'), { email: 'a@example.com' });
    });
    const db = await asUser(UID);
    await assertFails(updateDoc(doc(db, 'users', UID, 'userPrivate', 'profile'), { phoneNumber: '+970599123456' }));
    await assertFails(updateDoc(doc(db, 'users', UID, 'userPrivate', 'profile'), { phoneVerifiedAt: new Date() }));
  });

  it("another user cannot read someone's private profile", async () => {
    await seed(async db => {
      await setDoc(doc(db, 'users', UID, 'userPrivate', 'profile'), { phoneNumber: '+970599123456' });
    });
    const db = await asUser('u-other');
    await assertFails(getDoc(doc(db, 'users', UID, 'userPrivate', 'profile')));
  });
});

describe('smsConfig/otp (verification policy, emergency stop, review access)', () => {
  it('non-admins cannot read or flip the switches', async () => {
    const db = await asUser(UID);
    await assertFails(setDoc(doc(db, 'smsConfig', 'otp'), { enabled: true, emergencyStop: false }));
    await assertFails(getDoc(doc(db, 'smsConfig', 'otp')));
    await assertFails(getDoc(doc(await asAnon(), 'smsConfig', 'otp')));
  });

  it('admin clients can read but not write it (only audited server actions can)', async () => {
    await seed(async db => { await setDoc(doc(db, 'smsConfig', 'otp'), { businessId: 'biz', enabled: false }); });
    const admin = await asAdmin();
    await assertSucceeds(getDoc(doc(admin, 'smsConfig', 'otp')));
    await assertFails(updateDoc(doc(admin, 'smsConfig', 'otp'), { enabled: true, emergencyStop: false }));
    await assertFails(setDoc(doc(admin, 'smsConfig', 'otp'), { signin: { review: { enabled: true } } }, { merge: true }));
    const orgAdmin = await asUser('org-admin', { role: 'organization_admin', organizationId: 'biz' });
    await assertFails(updateDoc(doc(orgAdmin, 'smsConfig', 'otp'), { emergencyStop: false }));
  });
});

describe('public phone sign-in state + relay payloads', () => {
  beforeEach(async () => {
    await seed(async db => {
      await setDoc(doc(db, 'phoneAuthSessions', 's'.repeat(64)), { pow: { nonce: 'n' }, codes: 0 });
      await setDoc(doc(db, 'phoneAuthChallenges', 'c'.repeat(32)), { codeVerifier: 'x', status: 'pending' });
      await setDoc(doc(db, 'phoneAuthOps', 'c'.repeat(32)), { stage: 'verified', plannedUid: 'u' });
      await setDoc(doc(db, 'relayJobs', 'pauth_x'), { kind: 'phone_auth_otp', messageBody: 'code 123456', status: 'queued' });
      await setDoc(doc(db, 'smsRateLimits', 'dest_x'), { h: { s: 1, c: 1 } });
      await setDoc(doc(db, 'emailOtpLimits', 'e'.repeat(64)), { sendCount: 1 });
    });
  });

  it('anonymous and ordinary users cannot read or write any of it', async () => {
    for (const db of [await asAnon(), await asUser(UID)]) {
      await assertFails(getDoc(doc(db, 'phoneAuthSessions', 's'.repeat(64))));
      await assertFails(setDoc(doc(db, 'phoneAuthSessions', 's'.repeat(64)), { codes: 0 }));
      await assertFails(getDoc(doc(db, 'phoneAuthChallenges', 'c'.repeat(32))));
      await assertFails(updateDoc(doc(db, 'phoneAuthChallenges', 'c'.repeat(32)), { attempts: 0 }));
      await assertFails(getDoc(doc(db, 'phoneAuthOps', 'c'.repeat(32))));
      await assertFails(getDoc(doc(db, 'relayJobs', 'pauth_x')));
      await assertFails(setDoc(doc(db, 'relayJobs', 'pauth_y'), { kind: 'phone_auth_otp', status: 'queued' }));
      await assertFails(deleteDoc(doc(db, 'smsRateLimits', 'dest_x')));
      await assertFails(getDoc(doc(db, 'emailOtpLimits', 'e'.repeat(64))));
    }
  });

  it('admin clients cannot read verifiers/sessions or write any of it', async () => {
    const admin = await asAdmin();
    await assertFails(getDoc(doc(admin, 'phoneAuthSessions', 's'.repeat(64))));
    await assertFails(getDoc(doc(admin, 'phoneAuthChallenges', 'c'.repeat(32))));
    await assertSucceeds(getDoc(doc(admin, 'phoneAuthOps', 'c'.repeat(32))));
    await assertFails(updateDoc(doc(admin, 'phoneAuthOps', 'c'.repeat(32)), { stage: 'done' }));
    await assertFails(setDoc(doc(admin, 'relayJobs', 'forged'), { kind: 'phone_auth_otp', status: 'queued', messageBody: 'x' }));
    await assertFails(updateDoc(doc(admin, 'relayJobs', 'pauth_x'), { status: 'queued', policyVersion: 99 }));
    await assertFails(setDoc(doc(admin, 'smsRateLimits', 'dest_x'), {}));
  });
});
