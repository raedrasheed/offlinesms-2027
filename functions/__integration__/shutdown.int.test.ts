// Scenario 2 (legacy endpoints), scenario 9 (queued/retried/duplicate delivery
// and the emergency stop at the relay boundary) and the relay half of scenario
// 12 — against the real callables on the Firestore + Auth emulators.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  db, resetEmulators, seedPhoneLinkConfig, seedPolicy, seedRelayDevice, makeEmailUser, req, deviceReq,
  expectHttps, relayJobs, authUserCount, num, linkReq, deliveredCode, BUSINESS, Timestamp,
} from './harness';
import { requestPhoneOtp } from '../src/auth/requestPhoneOtp';
import { verifyPhoneOtp } from '../src/auth/verifyPhoneOtp';
import { getSupportedPhoneCountries } from '../src/auth/getSupportedPhoneCountries';
import { claimRelayJobs, reportRelayDelivery } from '../src/sms/relayJobs';
import { relayReaper } from '../src/sms/relayReaper';
import { handleRequestPhoneLinkOtp } from '../src/phoneLink/requestPhoneLinkOtp';

beforeEach(async () => {
  await resetEmulators();
  // Policy fully ON — the retired endpoints must still refuse.
  await seedPhoneLinkConfig();
  await seedRelayDevice();
});
afterEach(() => { process.env.PHONE_LINK_ENABLED = 'true'; });

describe('scenario 2 / M — the retired unprotected endpoints refuse every client version', () => {
  const payloads: unknown[] = [
    { phoneE164: num(1) },
    { phoneE164: '+970599999999' },                         // former app-review number
    { phoneE164: num(1), purpose: 'link' },                  // purpose smuggling
    { phoneE164: num(1), purpose: 'signin', force: true },
    {}, null, 'garbage',
  ];

  it.each(payloads)('requestPhoneOtp refuses %j with no side effects', async (data) => {
    const users = await authUserCount();
    await expectHttps(requestPhoneOtp.run(req(null, data)), 'failed-precondition', 'app-update-required');
    expect((await db().collection('otpChallenges').get()).size).toBe(0);
    expect((await relayJobs()).length).toBe(0);
    expect(await authUserCount()).toBe(users);
  });

  it('requestPhoneOtp refuses authenticated callers too', async () => {
    const u = await makeEmailUser();
    await expectHttps(requestPhoneOtp.run(req(u.uid, { phoneE164: num(2) })), 'failed-precondition', 'app-update-required');
    expect((await relayJobs()).length).toBe(0);
  });

  it('verifyPhoneOtp no longer accepts the fixed test credential or creates accounts', async () => {
    const users = await authUserCount();
    await expectHttps(verifyPhoneOtp.run(req(null, { phoneE164: '+970599999999', code: '123456' })), 'failed-precondition', 'app-update-required');
    // A pre-existing challenge from before the shutdown is inert.
    await db().collection('otpChallenges').doc('970599100003').set({ phoneE164: num(3), codeHash: 'x', salt: 'y', attempts: 0 });
    await expectHttps(verifyPhoneOtp.run(req(null, { phoneE164: num(3), code: '000000' })), 'failed-precondition', 'app-update-required');
    expect(await authUserCount()).toBe(users);
    expect((await db().collection('wallets').get()).size).toBe(0);
  });

  it('old builds see no countries; current builds see them only while sign-in is open', async () => {
    expect(await getSupportedPhoneCountries.run(req(null, {}))).toEqual({ countries: [] });
    expect(await getSupportedPhoneCountries.run(req(null, { v: 2 }))).toEqual({ available: true, countries: ['PS'] });
    await seedPolicy({ emergencyStop: true });
    expect(await getSupportedPhoneCountries.run(req(null, { v: 2 }))).toEqual({ available: false, countries: [] });
    await db().collection('smsConfig').doc('otp').set({ businessId: BUSINESS }); // today's production shape
    expect(await getSupportedPhoneCountries.run(req(null, { v: 2 }))).toEqual({ available: false, countries: [] });
  });

  it('a tampered purpose on the link endpoint is rejected without queuing', async () => {
    const u = await makeEmailUser();
    for (const purpose of ['signin', 'login', 'register', '', 0, null]) {
      await expectHttps(handleRequestPhoneLinkOtp(req(u.uid, linkReq(num(4), { purpose }))), 'invalid-argument', 'purpose-invalid');
    }
    expect((await relayJobs()).length).toBe(0);
  });
});

describe('scenario 9 — relay queue: legacy jobs, duplicates, retries, emergency stop', () => {
  async function queueJob(id: string, fields: Record<string, unknown>) {
    await db().collection('relayJobs').doc(id).set({
      jobId: id, businessId: BUSINESS, batchId: null, recipientUid: null,
      phoneE164: num(9), recipientCountryCode: 'PS', messageBody: 'Your code is 123456',
      status: 'queued', attempts: 0, maxAttempts: 1, assignedDeviceId: null,
      leaseOwnerDeviceId: null, leaseExpiresAt: null, nextAttemptAt: null, traceId: id,
      ...fields,
    });
  }

  it('legacy public OTP jobs still queued are cancelled at claim time, never delivered', async () => {
    await queueJob('otp_legacy_1', { kind: 'otp', recipientCountryCode: null });
    await queueJob('otp_legacy_2', { kind: 'otp' });
    const res = await claimRelayJobs.run(deviceReq({ capacity: 10 }));
    expect(res.jobs).toEqual([]);
    for (const id of ['otp_legacy_1', 'otp_legacy_2']) {
      const j = await db().collection('relayJobs').doc(id).get();
      expect(j.get('status')).toBe('failed');
      expect(j.get('lastError')).toBe('public-otp-disabled');
      expect(j.get('messageBody')).toBeUndefined();
    }
  });

  it('the reaper also purges queued legacy OTP jobs and expired link codes', async () => {
    await queueJob('otp_legacy_3', { kind: 'otp' });
    await queueJob('plink_expired', { kind: 'phone_link_otp', expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    // Current-generation code (bound to the policy's sender + version) survives…
    await queueJob('plink_live', { kind: 'phone_link_otp', policyVersion: 1, expiresAt: Timestamp.fromMillis(Date.now() + 120_000) });
    // …one with no generation (pre-binding) is undeliverable at claim/authorization anyway, so it is purged too.
    await queueJob('plink_ungenerated', { kind: 'phone_link_otp', expiresAt: Timestamp.fromMillis(Date.now() + 120_000) });
    await relayReaper.run({} as never);
    expect((await db().collection('relayJobs').doc('plink_ungenerated').get()).get('status')).toBe('failed');
    expect((await db().collection('relayJobs').doc('otp_legacy_3').get()).get('status')).toBe('failed');
    expect((await db().collection('relayJobs').doc('plink_expired').get()).get('status')).toBe('failed');
    expect((await db().collection('relayJobs').doc('plink_expired').get()).get('messageBody')).toBeUndefined();
    expect((await db().collection('relayJobs').doc('plink_live').get()).get('status')).toBe('queued');
  });

  it('one request → exactly one single-attempt job; a transient failure is NOT retried', async () => {
    const u = await makeEmailUser();
    const r = await handleRequestPhoneLinkOtp(req(u.uid, linkReq(num(10))));
    const jobs = await relayJobs('phone_link_otp');
    expect(jobs.map(j => j.id)).toEqual([`plink_${r.challengeId}`]);
    expect(jobs[0].get('maxAttempts')).toBe(1);

    const claimed = await claimRelayJobs.run(deviceReq({ capacity: 10 }));
    expect(claimed.jobs).toHaveLength(1);
    // Same device polls again: nothing new to hand out (no duplicate delivery).
    expect((await claimRelayJobs.run(deviceReq({ capacity: 10 }))).jobs).toHaveLength(0);

    const rep = await reportRelayDelivery.run(deviceReq({ jobId: `plink_${r.challengeId}`, status: 'failed', reason: 'timeout', androidResultCode: 1 }));
    expect(rep.requeued).toBe(false);
    const j = await db().collection('relayJobs').doc(`plink_${r.challengeId}`).get();
    expect(j.get('status')).toBe('failed');
    expect(j.get('messageBody')).toBeUndefined();
    expect((await claimRelayJobs.run(deviceReq({ capacity: 10 }))).jobs).toHaveLength(0);
  });

  it('an ambiguous timeout (lease lapsed, no report) fails the job instead of resending', async () => {
    const u = await makeEmailUser();
    const r = await handleRequestPhoneLinkOtp(req(u.uid, linkReq(num(11))));
    await claimRelayJobs.run(deviceReq({ capacity: 10 }));
    const ref = db().collection('relayJobs').doc(`plink_${r.challengeId}`);
    // Even a misconfigured maxAttempts must not make a verification job retry.
    await ref.update({ leaseExpiresAt: Timestamp.fromMillis(Date.now() - 1000), maxAttempts: 5 });
    await relayReaper.run({} as never);
    const j = await ref.get();
    expect(j.get('status')).toBe('failed');
    expect(j.get('lastError')).toBe('lease-expired-max-attempts');
    expect((await claimRelayJobs.run(deviceReq({ capacity: 10 }))).jobs).toHaveLength(0);
  });

  it('emergency stop: new requests refused and already-queued codes are not handed out', async () => {
    const u = await makeEmailUser();
    const r = await handleRequestPhoneLinkOtp(req(u.uid, linkReq(num(12))));
    await seedPhoneLinkConfig({ emergencyStop: true });

    const u2 = await makeEmailUser();
    await expectHttps(handleRequestPhoneLinkOtp(req(u2.uid, linkReq(num(13)))), 'unavailable', 'service-paused');
    expect((await claimRelayJobs.run(deviceReq({ capacity: 10 }))).jobs).toHaveLength(0);
    const j = await db().collection('relayJobs').doc(`plink_${r.challengeId}`).get();
    expect(j.get('status')).toBe('failed');
    expect(j.get('lastError')).toBe('sending-stopped');
    expect(j.get('messageBody')).toBeUndefined();
    expect((await relayJobs()).length).toBe(1);
  });

  it('missing/garbled runtime config fails closed (no sending)', async () => {
    const u = await makeEmailUser();
    await db().collection('smsConfig').doc('otp').delete();
    await expectHttps(handleRequestPhoneLinkOtp(req(u.uid, linkReq(num(14)))), 'failed-precondition', 'phone-link-disabled');
    await db().collection('smsConfig').doc('otp').set({ enabled: true, businessId: BUSINESS, link: { enabled: true } }); // no explicit emergencyStop:false
    await expectHttps(handleRequestPhoneLinkOtp(req(u.uid, linkReq(num(14)))), 'unavailable', 'service-paused');
    expect((await relayJobs()).length).toBe(0);
  });

  it('the deploy-time env gate overrides the runtime doc', async () => {
    const u = await makeEmailUser();
    process.env.PHONE_LINK_ENABLED = 'false';
    await expectHttps(handleRequestPhoneLinkOtp(req(u.uid, linkReq(num(15)))), 'failed-precondition', 'phone-link-disabled');
    process.env.PHONE_LINK_ENABLED = 'true';
    const r = await handleRequestPhoneLinkOtp(req(u.uid, linkReq(num(15))));
    // ...and a queued code is not handed out once the env gate is off again.
    process.env.PHONE_LINK_ENABLED = '';
    expect((await claimRelayJobs.run(deviceReq({ capacity: 10 }))).jobs).toHaveLength(0);
    expect((await db().collection('relayJobs').doc(`plink_${r.challengeId}`).get()).get('status')).toBe('failed');
  });

  it('a live, unexpired code is delivered exactly once with the code in the body', async () => {
    const u = await makeEmailUser();
    const r = await handleRequestPhoneLinkOtp(req(u.uid, linkReq(num(16))));
    const code = await deliveredCode(r.challengeId);
    const res = await claimRelayJobs.run(deviceReq({ capacity: 10 }));
    expect(res.jobs).toHaveLength(1);
    expect(res.jobs[0].messageBody).toContain(code);
    expect(res.jobs[0].phoneE164).toBe(num(16));
  });
});
