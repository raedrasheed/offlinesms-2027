import { beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { getAuth } from 'firebase-admin/auth';
import { db, resetEmulators, seedPolicy, authUserCount, relayJobs } from './harness';
import { FIXED_REVIEW_PHONE } from '../src/phoneAuth/fixedReview';

const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/restoreFixedReview.ts', '--project=demo-offlinesms', ...args], {
  cwd: process.cwd().endsWith('functions') ? '..' : process.cwd(), encoding: 'utf8',
  env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: '' }, timeout: 30_000,
});

beforeEach(async () => {
  await resetEmulators();
  await seedPolicy({ enabled: false, emergencyStop: true, signin: { enabled: false } });
});

describe('restore the existing fixed review account', () => {
  it('preserves uid, wallet and chats; removes phone ownership; repeat is safe; does not enable SMS', async () => {
    const u = await getAuth().createUser({ phoneNumber: FIXED_REVIEW_PHONE });
    await db().doc(`users/${u.uid}`).set({
      displayName: 'OfflineSMS Reviewer', username: 'reviewer', status: 'active',
      about: 'App Review demo account', phoneNumber: FIXED_REVIEW_PHONE, phoneVerified: true,
    });
    await db().doc(`users/${u.uid}/userPrivate/profile`).set({ phoneNumber: FIXED_REVIEW_PHONE });
    await db().doc(`wallets/${u.uid}`).set({ balance: 42, reserved: 2 });
    await db().doc('conversations/original').set({ participantUids: [u.uid], message: 'preserve' });
    const before = await authUserCount();
    const first = run();
    expect(first.status, first.stderr).toBe(0);
    const second = run();
    expect(second.status, second.stderr).toBe(0);
    expect(await authUserCount()).toBe(before);
    const user = await getAuth().getUser(u.uid);
    expect(user.customClaims).toEqual({ demoReview: true });
    expect(user.phoneNumber).toBeUndefined();
    expect((await db().doc(`users/${u.uid}`).get()).get('phoneVerified')).toBeUndefined();
    expect((await db().doc(`users/${u.uid}/userPrivate/profile`).get()).get('phoneNumber')).toBeUndefined();
    expect((await db().doc(`wallets/${u.uid}`).get()).data()).toEqual({ balance: 42, reserved: 2 });
    expect((await db().doc('conversations/original').get()).get('message')).toBe('preserve');
    const policy = (await db().doc('smsConfig/otp').get()).data()!;
    expect(policy).toMatchObject({ enabled: false, emergencyStop: true,
      signin: { enabled: false, fixedReview: { enabled: true, uid: u.uid } } });
    expect(policy.signin.fixedReview.expiresAtMs).toBeUndefined();
    expect((await relayJobs()).length).toBe(0);
    expect(run('--disable').status).toBe(0);
    expect((await db().doc('smsConfig/otp').get()).get('signin.fixedReview.enabled')).toBe(false);
  });

  it.each(['ordinary', 'admin'])('does not convert a %s account with the same number', async kind => {
    const u = await getAuth().createUser({ phoneNumber: FIXED_REVIEW_PHONE });
    await db().doc(`users/${u.uid}`).set({ status: 'active', displayName: 'Someone' });
    if (kind === 'admin') await getAuth().setCustomUserClaims(u.uid, { admin: true });
    expect(run().status).toBe(1);
    expect((await getAuth().getUser(u.uid)).phoneNumber).toBe(FIXED_REVIEW_PHONE);
    expect((await db().doc('smsConfig/otp').get()).get('signin.fixedReview')).toBeUndefined();
  });

  it('can bind an already-designated demo explicitly without creating a replacement account', async () => {
    const u = await getAuth().createUser({});
    await getAuth().setCustomUserClaims(u.uid, { demoReview: true });
    await db().doc(`users/${u.uid}`).set({ status: 'active', demo: true });
    expect(run(`--uid=${u.uid}`).status).toBe(0);
    expect((await db().doc('smsConfig/otp').get()).get('signin.fixedReview.uid')).toBe(u.uid);
    expect(await authUserCount()).toBe(1);
  });
});


describe('explicitly designate the existing fixed-number test account', () => {
  async function candidate() {
    const user = await getAuth().createUser({ phoneNumber: FIXED_REVIEW_PHONE });
    await db().doc(`users/${user.uid}`).set({
      displayName: 'Existing test account', username: 'my_test_account',
      about: 'Keep my profile', status: 'active', phoneNumber: FIXED_REVIEW_PHONE,
      phoneVerified: true, preferredTheme: 'dark',
    });
    await db().doc(`users/${user.uid}/userPrivate/profile`).set({ phoneNumber: FIXED_REVIEW_PHONE });
    return user.uid;
  }

  async function snapshot(uid: string) {
    return {
      auth: (await getAuth().getUser(uid)).toJSON(),
      profile: (await db().doc(`users/${uid}`).get()).data(),
      privateProfile: (await db().doc(`users/${uid}/userPrivate/profile`).get()).data(),
      policy: (await db().doc('smsConfig/otp').get()).data(),
      userCount: await authUserCount(),
      jobs: await relayJobs(),
    };
  }

  const designate = (uid: string) => run('--designate-existing-demo', `--uid=${uid}`);

  it('preserves the explicitly selected account and profile without impersonating the historical seed', async () => {
    const uid = await candidate();
    await db().doc(`wallets/${uid}`).set({ balance: 73, reserved: 4 });
    await db().doc('conversations/selected-demo').set({ participantUids: [uid], message: 'existing conversation' });
    await db().doc('conversations/selected-demo/messages/old-message').set({ senderUid: uid, text: 'Keep this message' });
    await db().doc(`users/${uid}/contacts/existing-contact`).set({ displayName: 'Existing contact' });
    const count = await authUserCount();
    const policyBefore = (await db().doc('smsConfig/otp').get()).data()!;

    // Supplying a UID alone must not silently turn an ordinary profile into a demo.
    const before = await snapshot(uid);
    expect(run(`--uid=${uid}`).status).toBe(1);
    expect(await snapshot(uid)).toEqual(before);

    const first = designate(uid);
    expect(first.status, first.stderr).toBe(0);
    const repeated = designate(uid);
    expect(repeated.status, repeated.stderr).toBe(0);
    expect(await authUserCount()).toBe(count);
    const user = await getAuth().getUser(uid);
    expect(user.customClaims).toEqual({ demoReview: true });
    expect(user.phoneNumber).toBeUndefined();
    const profile = (await db().doc(`users/${uid}`).get()).data()!;
    expect(profile).toMatchObject({
      displayName: 'Existing test account', username: 'my_test_account',
      about: 'Keep my profile', status: 'active', preferredTheme: 'dark', demo: true,
    });
    expect(profile.phoneNumber).toBeUndefined();
    expect(profile.phoneVerified).toBeUndefined();
    expect((await db().doc(`users/${uid}/userPrivate/profile`).get()).get('phoneNumber')).toBeUndefined();
    expect((await db().doc(`wallets/${uid}`).get()).data()).toEqual({ balance: 73, reserved: 4 });
    expect((await db().doc('conversations/selected-demo').get()).data())
      .toEqual({ participantUids: [uid], message: 'existing conversation' });
    expect((await db().doc('conversations/selected-demo/messages/old-message').get()).data())
      .toEqual({ senderUid: uid, text: 'Keep this message' });
    expect((await db().doc(`users/${uid}/contacts/existing-contact`).get()).data())
      .toEqual({ displayName: 'Existing contact' });
    const policy = (await db().doc('smsConfig/otp').get()).data()!;
    expect(policy).toMatchObject({
      ...policyBefore, signin: { ...policyBefore.signin, fixedReview: { enabled: true, uid } },
    });
    expect((await relayJobs()).length).toBe(0);
  });

  it('requires an explicit UID even when the number lookup would find an account', async () => {
    const uid = await candidate();
    const before = await snapshot(uid);
    expect(run('--designate-existing-demo').status).toBe(1);
    expect(await snapshot(uid)).toEqual(before);
  });

  const refusedCases: Array<{ name: string; change: (uid: string) => Promise<unknown> }> = [
    { name: 'another Auth phone', change: uid => getAuth().updateUser(uid, { phoneNumber: '+970599999998' }) },
    { name: 'no Auth phone on an undesignated account', change: uid => getAuth().updateUser(uid, { phoneNumber: null }) },
    { name: 'an Auth email', change: uid => getAuth().updateUser(uid, { email: 'not-a-demo@example.test' }) },
    { name: 'admin claims', change: uid => getAuth().setCustomUserClaims(uid, { admin: true }) },
    { name: 'nonempty claims even when admin is false', change: uid => getAuth().setCustomUserClaims(uid, { admin: false }) },
    { name: 'other custom claims', change: uid => getAuth().setCustomUserClaims(uid, { organizationId: 'existing-org' }) },
    { name: 'a disabled Auth account', change: uid => getAuth().updateUser(uid, { disabled: true }) },
    { name: 'an inactive profile', change: uid => db().doc(`users/${uid}`).update({ status: 'suspended' }) },
    { name: 'a missing profile', change: uid => db().doc(`users/${uid}`).delete() },
    { name: 'a public email', change: uid => db().doc(`users/${uid}`).update({ email: 'not-a-demo@example.test' }) },
    { name: 'another public phone', change: uid => db().doc(`users/${uid}`).update({ phoneNumber: '+970599999998' }) },
    { name: 'a private email', change: uid => db().doc(`users/${uid}/userPrivate/profile`).update({ email: 'not-a-demo@example.test' }) },
    { name: 'another private phone', change: uid => db().doc(`users/${uid}/userPrivate/profile`).update({ phoneNumber: '+970599999998' }) },
    { name: 'a binding to another UID', change: () => db().doc('smsConfig/otp').set({
      signin: { fixedReview: { enabled: false, uid: 'another-designated-account' } },
    }, { merge: true }) },
    { name: 'an enabled binding to another UID', change: () => db().doc('smsConfig/otp').set({
      signin: { fixedReview: { enabled: true, uid: 'another-designated-account' } },
    }, { merge: true }) },
    { name: 'a foreign sign-in provider', change: uid => getAuth().updateUser(uid, {
      providerToLink: { providerId: 'google.com', uid: 'external-provider-identity' },
    }) },
    { name: 'an enrolled second factor', change: uid => getAuth().updateUser(uid, {
      multiFactor: { enrolledFactors: [{ uid: 'existing-factor', factorId: 'phone', phoneNumber: '+14155550123' }] },
    }) },
  ];

  it.each(refusedCases)('refuses $name without modifying the account or policy', async ({ change }) => {
    const uid = await candidate();
    await change(uid);
    const before = await snapshot(uid);
    expect(designate(uid).status).toBe(1);
    expect(await snapshot(uid)).toEqual(before);
  });

  it.each([
    { admin: true }, { isAdmin: true }, { role: 'super_admin' },
    { roles: ['organization_admin'] }, { permissions: { canAccessAdmin: true } },
  ])('refuses privileged profile fields %j without removing them', async fields => {
    const uid = await candidate();
    await db().doc(`users/${uid}`).update(fields);
    const before = await snapshot(uid);
    expect(designate(uid).status).toBe(1);
    expect(await snapshot(uid)).toEqual(before);
  });
});
