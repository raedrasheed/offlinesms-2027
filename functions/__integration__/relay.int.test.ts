// Relay enforcement (R2–R5) through the real relay callables on the emulators.
// Layer: direct handler invocation of claimRelayJobs / authorizeRelaySend /
// reportRelayDelivery / relayHeartbeat / relayReaper. The Android side of the
// same boundary is covered by SendPipelineTest (JVM) and RelayIntegrationTest
// (Robolectric: Room + RelayApi over a fake transport), which parse the contract
// fixtures checked against the real handlers below. No SMS is sent anywhere.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  db, resetEmulators, seedPolicy, seedRelayDevice, makeEmailUser, req, deviceReq, job, expectHttps,
  num, linkReq, deliveredCode, BUSINESS, DEVICE, Timestamp,
} from './harness';
import { claimRelayJobs, reportRelayDelivery, authorizeRelaySend } from '../src/sms/relayJobs';
import { relayHeartbeat } from '../src/sms/relayDevices';
import { relayReaper } from '../src/sms/relayReaper';
import { handleRequestPhoneLinkOtp } from '../src/phoneLink/requestPhoneLinkOtp';
import { handleVerifyPhoneLinkOtp } from '../src/phoneLink/verifyPhoneLinkOtp';
import { utcDayKey } from '../src/sms/relayLogic';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    expect(await authorize(jobId)).toMatchObject({ ok: true });
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

describe('N3 — country routing is re-checked at final authorization', () => {
  it('routing switched off AFTER claim → refused, code purged', async () => {
    const { jobId } = await linkJob(60);
    await claim();
    await db().collection('relayDevices').doc(DEVICE).update({ countryRoutingEnabled: false });
    expect(await authorize(jobId)).toEqual({ ok: false, reason: 'country-not-allowed' });
    expect((await job(jobId))!).toMatchObject({ status: 'failed', lastError: 'country-not-allowed' });
    expect((await job(jobId))!.messageBody).toBeUndefined();
  });

  it('country removed AFTER claim (switch still on) → refused', async () => {
    const { jobId } = await linkJob(61);
    await claim();
    await db().collection('relayDevices').doc(DEVICE).update({ allowedCountryCodes: ['JO'] });
    expect(await authorize(jobId)).toEqual({ ok: false, reason: 'country-not-allowed' });
  });

  it('control: a still-authorized country is authorized', async () => {
    const { jobId } = await linkJob(62);
    await claim();
    await db().collection('relayDevices').doc(DEVICE).update({ allowedCountryCodes: ['JO', 'PS'] });
    expect(await authorize(jobId)).toMatchObject({ ok: true });
  });
});

describe('N4 — server deadlines are computed late and bounded', () => {
  it('claim reports the remaining lifetime at response time; authorization returns a short, bounded budget', async () => {
    const { jobId } = await linkJob(70);
    const exp = (await job(jobId))!.expiresAt.toMillis();
    const before = Date.now();
    const c = await claim();
    const after = Date.now();
    expect(c.jobs[0].sendWithinMs!).toBeLessThanOrEqual(exp - before);
    expect(c.jobs[0].sendWithinMs!).toBeGreaterThanOrEqual(exp - after - 50);
    const a = await authorize(jobId) as { ok: boolean; sendWithinMs: number };
    expect(a.ok).toBe(true);
    expect(a.sendWithinMs).toBeLessThanOrEqual(15_000);
    expect(a.sendWithinMs).toBeGreaterThan(0);
  });

  it('authorization budget never exceeds the code’s remaining lifetime', async () => {
    const { jobId } = await linkJob(71);
    await claim();
    await db().collection('relayJobs').doc(jobId).update({ expiresAt: Timestamp.fromMillis(Date.now() + 3_000) });
    const a = await authorize(jobId) as { ok: boolean; sendWithinMs: number };
    expect(a.ok).toBe(true);
    expect(a.sendWithinMs).toBeLessThanOrEqual(3_000);
  });
});

describe('N5 — server attempt identity and ambiguous hand-offs', () => {
  it('each lease carries its attempt number; a transient failure re-queues as the next attempt', async () => {
    await businessJob('a1');
    expect((await claim()).jobs[0]).toMatchObject({ jobId: 'a1', attempt: 1 });
    await report('a1', 'failed', { reason: 'no-service', androidResultCode: 4 });
    await db().collection('relayJobs').doc('a1').update({ nextAttemptAt: null }); // skip backoff for the test
    expect((await claim()).jobs[0]).toMatchObject({ jobId: 'a1', attempt: 2 });
    // Policy: the accounting unit is one claimed attempt, never refunded — the
    // retry consumed a second reservation; the job settles once when reported.
    const usage = (await db().collection('relayDevices').doc(DEVICE).get()).get('usage');
    expect([usage.m.c, usage.h.c, usage.d.c]).toEqual([2, 2, 2]);
    await report('a1', 'sent', { attempt: 2 }); // the relay binds every report to its attempt (M2)
    expect(await job('a1')).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it("a device-reported 'ambiguous-handoff' is permanent: never re-queued", async () => {
    await businessJob('a2');
    await claim();
    const r = await report('a2', 'failed', { reason: 'ambiguous-handoff' }) as { requeued: boolean };
    expect(r.requeued).toBe(false);
    expect((await job('a2'))!.status).toBe('failed');
    expect((await claim()).jobs).toEqual([]); // never handed out again
  });
});

describe('relay app contract — real handler responses match the fixtures the Android tests parse', () => {
  const fixture = (f: string) => JSON.parse(readFileSync(join(__dirname, '../../apps/mobile-relay/app/src/test/resources/relay-contract', f), 'utf-8'));
  const shape = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null ? 'null' : typeof v]));

  it('claimRelayJobs: same keys and value types for a verification and a business job', async () => {
    const want = fixture('claim-response.json');
    const { jobId } = await linkJob(80);
    await businessJob('b1');
    const got = await claim() as unknown as { jobs: Array<Record<string, unknown>>; capacityExhausted: unknown };
    expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
    const otp = got.jobs.find(j => j.jobId === jobId)!;
    const biz = got.jobs.find(j => j.jobId === 'b1')!;
    // assignedSimSubscriptionId is a number when the dispatcher pinned a SIM, else null.
    expect({ ...shape(otp), assignedSimSubscriptionId: 'number|null' }).toEqual({ ...shape(want.jobs[0]), assignedSimSubscriptionId: 'number|null' });
    expect(shape(biz)).toEqual(shape(want.jobs[1]));
  });

  it('authorizeRelaySend: same keys and value types', async () => {
    const { jobId } = await linkJob(81);
    await claim();
    expect(shape(await authorize(jobId) as Record<string, unknown>)).toEqual(shape(fixture('authorize-response.json')));
  });
});

// ── M1 / M2 (third review): every report is bound to ONE attempt ──────────
describe('M2 — reports are bound to the attempt they describe', () => {
  const DEV2 = 'relay-dev-2';
  const claimAs = (deviceId: string, extra: Record<string, unknown> = {}) =>
    claimRelayJobs.run(deviceReq({ capacity: 10, ...extra }, deviceId)) as Promise<{ jobs: Array<{ jobId: string; attempt: number }> }>;
  const reportAs = (deviceId: string, jobId: string, status: string, extra: Record<string, unknown> = {}) =>
    reportRelayDelivery.run(deviceReq({ jobId, status, ...extra }, deviceId)) as Promise<{ applied: boolean; requeued: boolean; notApplied?: string }>;
  const ready = (id: string) => db().collection('relayJobs').doc(id).update({ nextAttemptAt: null }); // skip backoff
  async function lapse(id: string) {
    await db().collection('relayJobs').doc(id).update({ leaseExpiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    await relayReaper.run({} as never);
    await ready(id);
  }
  const counters = async (dev = DEVICE) => (await db().collection('relayDevices').doc(dev).get()).get('counters') ?? {};
  const usage = async (dev = DEVICE) => {
    const u = (await db().collection('relayDevices').doc(dev).get()).get('usage');
    return [u?.m?.c ?? 0, u?.h?.c ?? 0, u?.d?.c ?? 0];
  };
  const TRANSIENT = { reason: 'no-service', androidResultCode: 4 };

  it('lost acknowledgment: the old attempt-1 failure, retried while attempt 2 is in flight on the SAME device, changes nothing', async () => {
    await businessJob('L1');
    expect((await claim()).jobs[0]).toMatchObject({ jobId: 'L1', attempt: 1 });
    expect(await report('L1', 'failed', { ...TRANSIENT, attempt: 1 })).toMatchObject({ applied: true, requeued: true });
    // …response lost; the device keeps the report and retries it later.
    await ready('L1');
    expect((await claim()).jobs[0]).toMatchObject({ jobId: 'L1', attempt: 2 });
    const before = await counters();
    expect(await report('L1', 'failed', { ...TRANSIENT, attempt: 1 })).toMatchObject({ applied: false, notApplied: 'stale' });
    expect(await job('L1')).toMatchObject({ status: 'claimed', attempts: 2, leaseOwnerDeviceId: DEVICE });
    expect(await counters()).toEqual(before);
    expect(await report('L1', 'sent', { attempt: 2 })).toMatchObject({ applied: true });
    expect(await job('L1')).toMatchObject({ status: 'sent', attempts: 2 });
    expect(await usage()).toEqual([2, 2, 2]); // one reservation per claimed attempt
  });

  it('a duplicate of an already-applied failure (lost ack, before any re-lease) is a no-op', async () => {
    await businessJob('L2');
    await claim();
    await report('L2', 'failed', { ...TRANSIENT, attempt: 1 });
    const j1 = await job('L2');
    const c1 = await counters();
    expect(await report('L2', 'failed', { ...TRANSIENT, attempt: 1 })).toMatchObject({ applied: false, notApplied: 'duplicate' });
    const j2 = await job('L2');
    expect(j2.status).toBe('queued');
    expect(j2.nextAttemptAt.toMillis()).toBe(j1.nextAttemptAt.toMillis());
    expect(await counters()).toEqual(c1);
  });

  it('a late SUCCESS for the attempt whose lease lapsed settles the job instead of sending it again', async () => {
    await businessJob('L3');
    await claim();
    await lapse('L3'); // reaper re-queued attempt 1
    expect((await job('L3'))!.status).toBe('queued');
    expect(await report('L3', 'sent', { attempt: 1 })).toMatchObject({ applied: true });
    expect(await job('L3')).toMatchObject({ status: 'sent', settledByAttempt: 1 });
    expect((await claim()).jobs).toEqual([]);
  });

  it('a late success for an OLDER attempt while a newer one is in flight: not applied to it, but no further attempt is ever created', async () => {
    await businessJob('L4');
    await claim();
    await lapse('L4');
    await claim(); // attempt 2
    expect(await report('L4', 'sent', { attempt: 1 })).toMatchObject({ applied: false, notApplied: 'stale' });
    expect(await job('L4')).toMatchObject({ status: 'claimed', attempts: 2, noRetry: true });
    // attempt 2 then fails transiently → NOT re-queued (attempt 1 already went out)
    expect(await report('L4', 'failed', { ...TRANSIENT, attempt: 2 })).toMatchObject({ applied: true, requeued: false });
    expect((await job('L4'))!.status).toBe('failed');
  });

  it('different-device re-lease: the first device\'s report for attempt 1 is not applied to attempt 2; reporting the current attempt from the wrong device is refused', async () => {
    await db().collection('relayDevices').doc(DEV2).set((await db().collection('relayDevices').doc(DEVICE).get()).data()!);
    await businessJob('L5');
    await claimAs(DEVICE);
    await lapse('L5');
    expect((await claimAs(DEV2)).jobs[0]).toMatchObject({ jobId: 'L5', attempt: 2 });
    expect(await reportAs(DEVICE, 'L5', 'failed', { ...TRANSIENT, attempt: 1 })).toMatchObject({ applied: false, notApplied: 'stale' });
    expect(await job('L5')).toMatchObject({ status: 'claimed', attempts: 2, leaseOwnerDeviceId: DEV2 });
    await expectHttps(reportAs(DEVICE, 'L5', 'sent', { attempt: 2 }), 'permission-denied', 'not-lease-owner');
    expect(await reportAs(DEV2, 'L5', 'delivered', { attempt: 2 })).toMatchObject({ applied: true });
  });

  it('reports without attempt identity (old builds, pre-upgrade pending reports): applied only to a never-re-leased job', async () => {
    await businessJob('L6');
    await claim();
    expect(await report('L6', 'failed', TRANSIENT)).toMatchObject({ applied: true, requeued: true }); // attempt 1: unambiguous
    await ready('L6');
    await claim(); // attempt 2
    expect(await report('L6', 'failed', TRANSIENT)).toMatchObject({ applied: false, notApplied: 'unbound' });
    expect(await job('L6')).toMatchObject({ status: 'claimed', attempts: 2 });
  });

  it('a build that does not bind reports to attempts is never handed a re-lease', async () => {
    await businessJob('L7');
    const oldCaps = { clientCaps: ['send-auth-v1'] };
    expect((await claim(10, oldCaps)).jobs.map(j => j.jobId)).toEqual(['L7']); // first attempt: fine
    await lapse('L7');
    expect((await claim(10, oldCaps)).jobs).toEqual([]);
    expect((await claim()).jobs[0]).toMatchObject({ jobId: 'L7', attempt: 2 });
  });
});

describe('M1 (server side) — an ambiguous hand-off reported late still stops every further attempt', () => {
  it('ambiguity for attempt 2 delivered after two lease expiries and a third lease: no attempt 4; reservations count the 3 leases', async () => {
    await businessJob('A1', { maxAttempts: 5 });
    const lapse = async () => {
      await db().collection('relayJobs').doc('A1').update({ leaseExpiresAt: Timestamp.fromMillis(Date.now() - 1000) });
      await relayReaper.run({} as never);
      await db().collection('relayJobs').doc('A1').update({ nextAttemptAt: null });
    };
    await claim();          // attempt 1 — may have been handed off, then the device went quiet
    await lapse();
    await claim();          // attempt 2 — the device refuses it as ambiguous; its report is held offline
    await lapse();
    await claim();          // attempt 3
    expect((await job('A1'))!.attempts).toBe(3);
    // the delayed attempt-2 report arrives now
    const late = await report('A1', 'failed', { reason: 'ambiguous-handoff', attempt: 2 }) as { notApplied?: string };
    expect(late.notApplied).toBe('stale');
    expect((await job('A1'))!.noRetry).toBe(true);
    // attempt 3's lease lapses too → failed, never re-queued
    await lapse();
    expect(await job('A1')).toMatchObject({ status: 'failed', lastError: 'lease-expired-no-retry' });
    expect((await claim()).jobs).toEqual([]);
    const u = (await db().collection('relayDevices').doc(DEVICE).get()).get('usage');
    expect([u.m.c, u.h.c, u.d.c]).toEqual([3, 3, 3]);
  });
});

describe('settlement with a real batch + recipient (attempt-bound reports)', () => {
  it('retry then success settles the recipient and finalizes the batch once; a stale duplicate afterwards changes nothing', async () => {
    const B = 'batch-m2';
    await db().collection('smsBatches').doc(B).set({ businessId: BUSINESS, status: 'sending', channel: 'relay' });
    await db().collection('smsBatches').doc(B).collection('recipients').doc('r1').set({ smsStatus: 'queued' });
    await businessJob('S1', { batchId: B, recipientUid: 'r1' });
    await claim();
    await report('S1', 'failed', { reason: 'no-service', androidResultCode: 4, attempt: 1 });
    expect((await db().collection('smsBatches').doc(B).get()).get('status')).toBe('sending'); // not final while re-queued
    await db().collection('relayJobs').doc('S1').update({ nextAttemptAt: null });
    await claim();
    await report('S1', 'sent', { attempt: 2 });
    const rcp = db().collection('smsBatches').doc(B).collection('recipients').doc('r1');
    expect((await rcp.get()).get('smsStatus')).toBe('sent');
    const b1 = (await db().collection('smsBatches').doc(B).get()).data()!;
    expect(b1).toMatchObject({ status: 'completed', sentCount: 1, failedCount: 0 });
    // the attempt-1 failure retried after a lost acknowledgment
    expect(await report('S1', 'failed', { reason: 'no-service', androidResultCode: 4, attempt: 1 })).toMatchObject({ applied: false, notApplied: 'stale' });
    expect((await rcp.get()).get('smsStatus')).toBe('sent');
    const b2 = (await db().collection('smsBatches').doc(B).get()).data()!;
    expect(b2.relayFinalizedAt.toMillis()).toBe(b1.relayFinalizedAt.toMillis());
    expect(b2).toMatchObject({ status: 'completed', sentCount: 1, failedCount: 0 });
  });
});
