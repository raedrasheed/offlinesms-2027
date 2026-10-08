// Relay enforcement (R2–R5) through the real relay callables on the emulators.
// Layer: direct handler invocation of claimRelayJobs / authorizeRelaySend /
// reportRelayDelivery / relayHeartbeat / relayReaper. The Android side of the
// same boundary (pause per job, duplicate local job, fail-closed authorization)
// is covered by SendGateTest (JVM). No SMS is sent anywhere.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  db, resetEmulators, seedPolicy, seedRelayDevice, makeEmailUser, req, deviceReq, job,
  num, linkReq, deliveredCode, BUSINESS, DEVICE, Timestamp,
} from './harness';
import { claimRelayJobs, reportRelayDelivery, authorizeRelaySend } from '../src/sms/relayJobs';
import { relayHeartbeat } from '../src/sms/relayDevices';
import { relayReaper } from '../src/sms/relayReaper';
import { handleRequestPhoneLinkOtp } from '../src/phoneLink/requestPhoneLinkOtp';
import { handleVerifyPhoneLinkOtp } from '../src/phoneLink/verifyPhoneLinkOtp';
import { utcDayKey } from '../src/sms/relayLogic';

const claim = (capacity = 10, extra: Record<string, unknown> = {}) =>
  claimRelayJobs.run(deviceReq({ capacity, ...extra })) as Promise<{ jobs: Array<{ jobId: string; kind: string | null; requiresSendAuth: boolean; sendWithinMs: number | null }>; capacityExhausted: string | null }>;
const authorize = (jobId: string) => authorizeRelaySend.run(deviceReq({ jobId })) as Promise<{ ok: boolean; reason?: string }>;
const report = (jobId: string, status: string, extra: Record<string, unknown> = {}) =>
  reportRelayDelivery.run(deviceReq({ jobId, status, ...extra }));

async function businessJob(id: string, over: Record<string, unknown> = {}) {
  await db().collection('relayJobs').doc(id).set({
    jobId: id, businessId: BUSINESS, batchId: null, recipientUid: null,
    phoneE164: num(900), recipientCountryCode: 'PS', messageBody: 'hello',
    status: 'queued', attempts: 0, maxAttempts: 3, assignedDeviceId: null,
    leaseOwnerDeviceId: null, leaseExpiresAt: null, nextAttemptAt: null, traceId: id, ...over,
  });
}
async function setCaps(caps: Record<string, number>, usage?: unknown) {
  await db().collection('relayDevices').doc(DEVICE).set({ caps, ...(usage ? { usage } : {}) }, { merge: true });
}
async function linkJob(n: number) {
  const u = await makeEmailUser();
  const r = await handleRequestPhoneLinkOtp(req(u.uid, linkReq(num(n)))) as { challengeId: string };
  return { u, r, jobId: `plink_${r.challengeId}` };
}

beforeEach(async () => {
  await resetEmulators();
  await seedPolicy();
  await seedRelayDevice();
});

describe('E (R2) — heartbeats never touch enforcement counters', () => {
  it("the Android app's real heartbeat payload after sends cannot reopen capacity", async () => {
    await setCaps({ maxPerMinute: 10, maxPerHour: 10, maxPerDay: 1 });
    await businessJob('b1'); await businessJob('b2');
    expect((await claim()).jobs.map(j => j.jobId)).toEqual(['b1']);
    await report('b1', 'sent');
    const before = (await db().collection('relayDevices').doc(DEVICE).get()).data()!;
    // Exactly what RelayService/RelayApi sent before this change: zeros.
    await relayHeartbeat.run(deviceReq({ fcmToken: 't', appVersion: '0.1.0', simInfo: [], queueDepth: 0, sentToday: 0, failedToday: 0, lastError: null }));
    const after = (await db().collection('relayDevices').doc(DEVICE).get()).data()!;
    expect(after.usage).toEqual(before.usage);
    expect(after.counters).toEqual(before.counters);
    expect(after.telemetry).toMatchObject({ sentToday: 0, failedToday: 0, queueDepth: 0 });
    const r = await claim();
    expect(r.jobs).toHaveLength(0);
    expect(r.capacityExhausted).toBe('day');
  });

  it('negative, inflated and missing telemetry is clamped/ignored', async () => {
    await relayHeartbeat.run(deviceReq({ sentToday: -5, failedToday: 1e12, queueDepth: 'x' }));
    const t = (await db().collection('relayDevices').doc(DEVICE).get()).get('telemetry');
    expect(t.sentToday).toBe(0);
    expect(t.failedToday).toBe(1_000_000);
    expect(t.queueDepth).toBeUndefined();
    await relayHeartbeat.run(deviceReq({}));
  });
});

describe('F (R3) — atomic reservations at claim time', () => {
  it('parallel claims cannot oversubscribe the minute cap; hour and day caps apply', async () => {
    await setCaps({ maxPerMinute: 2, maxPerHour: 3, maxPerDay: 100 });
    for (let i = 0; i < 6; i++) await businessJob(`p${i}`);
    const rs = await Promise.all([claim(5), claim(5), claim(5)]);
    const total = rs.reduce((n, r) => n + r.jobs.length, 0);
    expect(total).toBe(2);
    const u = (await db().collection('relayDevices').doc(DEVICE).get()).get('usage');
    expect(u.m.c).toBe(2);
    // Simulate the minute passing; the hour cap (3) now binds.
    await db().collection('relayDevices').doc(DEVICE).update({ 'usage.m': { s: Date.now() - 61_000, c: 2 } });
    expect((await claim(5)).jobs).toHaveLength(1);
    await db().collection('relayDevices').doc(DEVICE).update({ 'usage.m': { s: Date.now() - 61_000, c: 1 } });
    expect((await claim(5)).capacityExhausted).toBe('hour');
  });

  it("a new UTC day starts fresh even when yesterday's cap was reached", async () => {
    await setCaps({ maxPerMinute: 100, maxPerHour: 100, maxPerDay: 1 }, { d: { key: '19990101', c: 1 } });
    await businessJob('d1');
    expect((await claim()).jobs).toHaveLength(1);
    expect((await db().collection('relayDevices').doc(DEVICE).get()).get('usage.d')).toEqual({ key: utcDayKey(), c: 1 });
  });

  it('claimed-but-unreported jobs keep counting (delayed reports cannot free capacity)', async () => {
    await setCaps({ maxPerMinute: 100, maxPerHour: 100, maxPerDay: 2 });
    for (let i = 0; i < 3; i++) await businessJob(`q${i}`);
    expect((await claim()).jobs).toHaveLength(2);
    expect((await claim()).jobs).toHaveLength(0); // nothing reported yet
    await report('q0', 'failed', { reason: 'invalid' }); // a failure is not refunded either
    expect((await claim()).jobs).toHaveLength(0);
  });
});

describe('A11 — duplicate / out-of-order reports', () => {
  it('delivered-before-sent counts the send once; late or duplicate reports change nothing', async () => {
    await businessJob('r1');
    await claim();
    await report('r1', 'delivered');
    await report('r1', 'sent');
    await report('r1', 'delivered');
    await report('r1', 'failed', { reason: 'timeout' });
    const c = (await db().collection('relayDevices').doc(DEVICE).get()).get('counters');
    expect(c).toMatchObject({ sentToday: 1, deliveredToday: 1, failedToday: 0 });
    const j = (await job('r1'))!;
    expect(j.status).toBe('delivered');
    expect(j.sentAt).toBeDefined();
    expect(j.messageBody).toBeUndefined();
  });
});

describe('G (R4) — stop / expiry / supersession / pause after claim, before hand-off', () => {
  it('a claimed verification code is refused at authorization after an emergency stop', async () => {
    const { jobId } = await linkJob(10);
    const c = await claim();
    expect(c.jobs[0]).toMatchObject({ jobId, requiresSendAuth: true });
    expect(c.jobs[0].sendWithinMs).toBeGreaterThan(0);
    await seedPolicy({ emergencyStop: true });
    expect(await authorize(jobId)).toEqual({ ok: false, reason: 'sending-stopped' });
    const j = (await job(jobId))!;
    expect(j.status).toBe('failed');
    expect(j.messageBody).toBeUndefined();
  });

  it('expired, superseded, consumed and deleted challenges are refused at authorization', async () => {
    // Superseded by a newer request.
    const a = await linkJob(20);
    await claim();
    await db().collection('smsRateLimits').doc(`acct_${a.u.uid}`).delete(); // skip the cooldown for the test
    await db().collection('smsRateLimits').get().then(s => Promise.all(s.docs.filter(d => d.id.startsWith('dest_')).map(d => d.ref.delete())));
    await handleRequestPhoneLinkOtp(req(a.u.uid, linkReq(num(20))));
    expect(await authorize(a.jobId)).toEqual({ ok: false, reason: 'challenge-not-current' });
    // Consumed (verified) before the device got to it.
    const b = await linkJob(21);
    await claim();
    await handleVerifyPhoneLinkOtp(req(b.u.uid, { challengeId: b.r.challengeId, code: await deliveredCode(b.r.challengeId) }));
    expect(await authorize(b.jobId)).toEqual({ ok: false, reason: 'challenge-not-current' });
    // Challenge deleted (e.g. account deletion).
    const c = await linkJob(22);
    await claim();
    await db().collection('phoneLinkChallenges').doc(c.u.uid).delete();
    expect(await authorize(c.jobId)).toEqual({ ok: false, reason: 'challenge-not-current' });
    // Expired while held by the device.
    const d = await linkJob(23);
    await claim();
    await db().collection('relayJobs').doc(d.jobId).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1) });
    expect(await authorize(d.jobId)).toEqual({ ok: false, reason: 'expired' });
  });

  it('authorization is single-use (no duplicate hand-off) and needs the lease and an active device', async () => {
    const { jobId } = await linkJob(30);
    await claim();
    expect(await authorize(jobId)).toEqual({ ok: true });
    expect((await job(jobId))!.status).toBe('sending');
    expect(await authorize(jobId)).toEqual({ ok: false, reason: 'already-authorized' });

    const second = await linkJob(31);
    await claim();
    await db().collection('relayDevices').doc(DEVICE).update({ status: 'paused' });
    expect(await authorize(second.jobId)).toEqual({ ok: false, reason: 'device-paused' });
    await db().collection('relayDevices').doc(DEVICE).update({ status: 'revoked' });
    expect(await authorize(second.jobId)).toEqual({ ok: false, reason: 'device-revoked' });
  });

  it('after a relay restart / reconnection, stale queued codes are cancelled, never drained', async () => {
    const { jobId } = await linkJob(40);
    await db().collection('relayJobs').doc(jobId).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    // A pre-migration verification job without the new fields is treated conservatively.
    await businessJob('legacy-link', { kind: 'phone_link_otp' });
    const r = await claim();
    expect(r.jobs).toHaveLength(0);
    expect((await job(jobId))!.lastError).toBe('expired');
    expect((await job('legacy-link'))!.status).toBe('failed');
  });
});

describe('H (R5) — sender, routing and capability changes', () => {
  it('codes admitted for sender A are not delivered after switching to B (policy generation bound)', async () => {
    const { jobId } = await linkJob(50);
    await seedPolicy({ businessId: 'biz-other', policyVersion: 2 });
    expect((await claim()).jobs).toHaveLength(0);
    expect((await job(jobId))!).toMatchObject({ status: 'failed', lastError: 'policy-changed' });
    // Same sender, bumped generation (e.g. a stop/resume cycle).
    const b = await linkJob(51).catch(() => null);
    expect(b).toBeNull(); // policy now names another sender → no coverage for this device's org
  });

  it('a policyVersion bump strands claimed codes at authorization', async () => {
    const { jobId } = await linkJob(52);
    await claim();
    await seedPolicy({ policyVersion: 7 });
    expect(await authorize(jobId)).toEqual({ ok: false, reason: 'policy-changed' });
  });

  it('clearing the sender stops delivery of already-queued codes', async () => {
    const { jobId } = await linkJob(53);
    await seedPolicy({ businessId: null });
    expect((await claim()).jobs).toHaveLength(0);
    expect((await job(jobId))!.lastError).toBe('sending-stopped');
  });

  it('country routing disabled (codes still listed) → no tagged jobs claimed', async () => {
    await businessJob('c1');
    await db().collection('relayDevices').doc(DEVICE).update({ countryRoutingEnabled: false });
    expect((await claim()).jobs).toHaveLength(0);
    expect((await job('c1'))!.status).toBe('queued');
  });

  it('an older relay build (no send-auth capability) never receives verification codes', async () => {
    const { jobId } = await linkJob(54);
    await businessJob('biz-1');
    const r = await claim(10, { clientCaps: [] });
    expect(r.jobs.map(j => j.jobId)).toEqual(['biz-1']);
    expect((await job(jobId))!.status).toBe('queued');
  });

  it('a paused or revoked device cannot claim', async () => {
    await businessJob('x1');
    await db().collection('relayDevices').doc(DEVICE).update({ status: 'paused' });
    await expect(claim()).rejects.toThrow('device-paused');
    await db().collection('relayDevices').doc(DEVICE).update({ status: 'revoked' });
    await expect(claim()).rejects.toThrow('device-revoked');
  });

  it('business SMS keep working without authorization (non-OTP path preserved)', async () => {
    await businessJob('ok1');
    const r = await claim();
    expect(r.jobs[0]).toMatchObject({ jobId: 'ok1', requiresSendAuth: false, kind: null });
    await report('ok1', 'sent');
    expect((await job('ok1'))!.status).toBe('sent');
    await relayReaper.run({} as never);
    expect((await job('ok1'))!.status).toBe('sent');
  });
});
