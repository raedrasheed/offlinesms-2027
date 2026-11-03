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
