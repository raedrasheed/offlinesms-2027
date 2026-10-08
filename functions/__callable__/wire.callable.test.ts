// Wire-level tests: raw HTTP calls to the deployed-shape callables in the
// Functions emulator. Proves that direct HTTP clients (not the app) hit the same
// server gates, and exercises the framework's real ID-token verification.
// Limits of this layer: the emulator does not enforce App Check, has no Google
// front end (so X-Forwarded-For is whatever the client sends), and sends no SMS.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { createHash } from 'node:crypto';

const PROJECT = 'demo-offlinesms';
const FN = (name: string) => `http://127.0.0.1:5001/${PROJECT}/us-central1/${name}`;
if (process.env.GCLOUD_PROJECT !== PROJECT
  || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080'
  || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') {
  throw new Error('wire tests require demo-offlinesms and the exact local emulator hosts');
}
if (getApps().length === 0) initializeApp({ projectId: PROJECT });
const db = () => getFirestore();

async function call(name: string, data: unknown, idToken?: string) {
  const res = await fetch(FN(name), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(idToken ? { authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({})) as { result?: any; error?: { status: string; message: string; details?: any } };
  return { http: res.status, ...body };
}

async function idTokenFor(uid: string, claims?: Record<string, unknown>): Promise<string> {
  const custom = await getAuth().createCustomToken(uid, claims);
  const r = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  return ((await r.json()) as { idToken: string }).idToken;
}

function solve(nonce: string, e164: string, bits: number): string {
  for (let i = 0; ; i++) {
    const d = createHash('sha256').update(`pow:v1:${nonce}:${e164}:${i}`).digest();
    let z = 0;
    for (const b of d) { if (b === 0) { z += 8; continue; } z += Math.clz32(b) - 24; break; }
    if (z >= bits) return String(i);
  }
}

async function reset() {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await db().collection('smsConfig').doc('otp').set({
    enabled: true, emergencyStop: false, businessId: 'biz-wire', policyVersion: 1,
    signin: { enabled: true, limits: { powBits: 8, powMaxBits: 8 } }, link: { enabled: true },
  });
  await db().collection('relayDevices').doc('dev-wire').set({
    businessId: 'biz-wire', status: 'active', lastHeartbeatAt: Timestamp.now(),
    countryRoutingEnabled: true, allowedCountryCodes: ['PS'], caps: { maxPerMinute: 100, maxPerHour: 100, maxPerDay: 100 },
  });
}

beforeAll(async () => { await reset(); });
beforeEach(async () => { await reset(); });

describe('retired endpoints over HTTP', () => {
  it('requestPhoneOtp / verifyPhoneOtp refuse any raw payload', async () => {
    for (const data of [{ phoneE164: '+970599100001' }, { phoneE164: '+970599999999', code: '123456' }, {}]) {
      const a = await call('requestPhoneOtp', data);
      expect(a.error).toMatchObject({ status: 'FAILED_PRECONDITION', message: 'app-update-required' });
      const b = await call('verifyPhoneOtp', data);
      expect(b.error).toMatchObject({ status: 'FAILED_PRECONDITION', message: 'app-update-required' });
    }
    expect((await db().collection('relayJobs').get()).size).toBe(0);
  });
});

describe('public phone sign-in over HTTP (no app, no UI)', () => {
  it('direct calls without a valid proof never queue an SMS; a valid proof queues exactly one', async () => {
    const s = (await call('startPhoneAuth', {})).result as { sessionToken: string; pow: { nonce: string; bits: number } };
    expect(s.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const phone = '+970599100002';
    const bad = await call('requestPhoneAuthCode', { sessionToken: s.sessionToken, phoneE164: phone, requestId: 'req-wire-0001', powNonce: s.pow.nonce, powSolution: '1' });
    expect(bad.error).toMatchObject({ status: 'PERMISSION_DENIED', message: 'proof-invalid' });
    expect((await db().collection('relayJobs').get()).size).toBe(0);
    const next = bad.error!.details.pow as { nonce: string; bits: number };
    const ok = await call('requestPhoneAuthCode', {
      sessionToken: s.sessionToken, phoneE164: phone, requestId: 'req-wire-0002', powNonce: next.nonce, powSolution: solve(next.nonce, phone, next.bits),
    });
    expect(ok.result.challengeId).toMatch(/^[0-9a-f]{32}$/);
    const jobs = await db().collection('relayJobs').get();
    expect(jobs.size).toBe(1);
    expect(jobs.docs[0].id).toBe(`pauth_${ok.result.challengeId}`);
    // The response never contains the code or the full number.
    expect(JSON.stringify(ok)).not.toMatch(/599100002/);
    const body = jobs.docs[0].get('messageBody') as string;
    expect(JSON.stringify(ok)).not.toContain(/\b(\d{6})\b/.exec(body)![1]);
  });
});

describe('authenticated callables: real token verification', () => {
  it('no token → UNAUTHENTICATED; a malformed token never reaches the handler', async () => {
    const none = await call('getPhoneLinkStatus', {});
    expect(none.error).toMatchObject({ status: 'UNAUTHENTICATED' });
    // NOTE (layer limit): the Auth emulator does not verify token SIGNATURES, so
    // this layer cannot prove production signature checking — only that the
    // framework's verification path rejects a malformed token.
    const forged = await call('getPhoneLinkStatus', {}, 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.');
    expect(forged.result).toBeUndefined();
    expect(forged.http).toBeGreaterThanOrEqual(400);
  });

  it('a genuine emulator ID token reaches the handler; a normal user cannot act as a relay device', async () => {
    const u = await getAuth().createUser({ email: 'wire@example.test', emailVerified: true });
    await db().collection('users').doc(u.uid).set({ status: 'active' });
    const token = await idTokenFor(u.uid);
    const st = await call('getPhoneLinkStatus', {}, token);
    expect(st.result).toMatchObject({ available: true, linked: false, eligible: true });
    const claim = await call('claimRelayJobs', { deviceId: 'dev-wire', capacity: 5, clientCaps: ['send-auth-v1'] }, token);
    expect(claim.error).toMatchObject({ status: 'PERMISSION_DENIED', message: 'not-a-relay-device' });
    const auth = await call('authorizeRelaySend', { deviceId: 'dev-wire', jobId: 'x' }, token);
    expect(auth.error).toMatchObject({ status: 'PERMISSION_DENIED' });
  });

  it("a device token can't claim another device's id", async () => {
    const t = await idTokenFor('dev-other', { relayDevice: true, deviceId: 'dev-other', businessId: 'biz-wire' });
    const r = await call('claimRelayJobs', { deviceId: 'dev-wire', capacity: 5 }, t);
    expect(r.error).toMatchObject({ status: 'PERMISSION_DENIED', message: 'device-id-mismatch' });
  });
});

// ── Second-round review: trigger boundaries (real Firestore triggers in the
// Functions emulator, not handler-level assertions).

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > until) throw new Error('timed out waiting for trigger');
    await new Promise(r => setTimeout(r, 250));
  }
}

async function phoneSignin(phone: string, code: (challengeId: string) => Promise<string>) {
  const s = (await call('startPhoneAuth', {})).result as { sessionToken: string; pow: { nonce: string; bits: number } };
  const r = await call('requestPhoneAuthCode', {
    sessionToken: s.sessionToken, phoneE164: phone, requestId: `req-${phone.slice(-6)}-${Date.now()}`,
    powNonce: s.pow.nonce, powSolution: solve(s.pow.nonce, phone, s.pow.bits),
  });
  expect(r.error).toBeUndefined();
  const challengeId = r.result.challengeId as string;
  const v = await call('verifyPhoneAuthCode', { sessionToken: s.sessionToken, challengeId, code: await code(challengeId) });
  expect(v.error).toBeUndefined();
  return v.result as { uid: string; customToken: string };
}

async function groupWithExternal(id: string, phone: string) {
  const ref = db().collection('conversations').doc(id);
  await ref.set({ type: 'group', participantUids: ['owner-x'], memberIds: ['owner-x'], memberCount: 1, externalMemberCount: 1 });
  const digits = phone.replace(/\D/g, '');
  await ref.collection('externalMembers').doc(digits).set({ normalizedPhone: digits, phoneE164: phone, displayName: 'Ext', isRegistered: false });
  return ref;
}

describe('N2 — store-review login over HTTP never reaches phone-linking triggers', () => {
  it('review login: no phone recorded, no group promotion; a normal sign-in in the same run IS promoted (trigger live)', async () => {
    const REVIEW = '+970599100071';
    const NORMAL = '+970599100072';
    const CODE = '246813';
    const demo = await getAuth().createUser({ displayName: 'Demo' });
    await getAuth().setCustomUserClaims(demo.uid, { demoReview: true });
    await db().collection('users').doc(demo.uid).set({ displayName: 'Demo', status: 'active', demo: true });
    const codeSalt = 'wire-salt-0123456789abcdef';
    await db().collection('smsConfig').doc('otp').set({ signin: { review: {
      enabled: true, phoneE164: REVIEW, codeSalt, codeHash: createHash('sha256').update(`${codeSalt}:${CODE}`).digest('hex'),
      uid: demo.uid, expiresAtMs: Date.now() + 86_400_000,
    } } }, { merge: true });
    const reviewGroup = await groupWithExternal('grp-review', REVIEW);
    const normalGroup = await groupWithExternal('grp-normal', NORMAL);
    // A real user's private contact for each number (contact ownership must not move to the demo).
    const contact = (id: string, phone: string) => db().collection('phoneContacts').doc(id).set({
      contactId: id, ownerUid: 'owner-x', phoneE164: phone, normalizedPhone: phone.replace(/\D/g, ''), isRegistered: false,
    });
    await contact('c-review', REVIEW);
    await contact('c-normal', NORMAL);

    const rev = await phoneSignin(REVIEW, async () => CODE);
    expect(rev.uid).toBe(demo.uid);
    expect((await db().collection('relayJobs').where('phoneE164', '==', REVIEW).get()).size).toBe(0);

    // Positive control: the real trigger runs and promotes a genuine phone sign-in.
    const normal = await phoneSignin(NORMAL, async id => {
      const body = (await db().collection('relayJobs').doc(`pauth_${id}`).get()).get('messageBody') as string;
      return /\b(\d{6})\b/.exec(body)![1];
    });
    await waitFor(async () => ((await normalGroup.get()).get('participantUids') as string[]).includes(normal.uid));
    await new Promise(r => setTimeout(r, 1500)); // let any (wrongly) queued review trigger land too

    expect((await db().collection('phoneContacts').doc('c-normal').get()).get('linkedUid')).toBe(normal.uid); // trigger live
    expect((await reviewGroup.get()).get('participantUids')).toEqual(['owner-x']);
    const rc = (await db().collection('phoneContacts').doc('c-review').get()).data()!;
    expect(rc.isRegistered).toBe(false);
    expect(rc.linkedUid).toBeUndefined();
    expect((await reviewGroup.collection('externalMembers').doc(REVIEW.replace(/\D/g, '')).get()).get('isRegistered')).toBe(false);
    expect((await db().collection('users').doc(demo.uid).collection('userPrivate').doc('profile').get()).exists).toBe(false);
    expect((await db().collection('users').doc(demo.uid).get()).get('phoneVerified')).toBeUndefined();
    expect((await getAuth().getUser(demo.uid)).phoneNumber).toBeUndefined();
  });
});

describe('N6 — a policy write triggers the conditional stale-code sweep', () => {
  it('bumping policyVersion cancels old-generation queued codes; current-generation codes survive', async () => {
    const base = {
      kind: 'phone_auth_otp', purpose: 'signin', businessId: 'biz-wire', status: 'queued', messageBody: 'code 111111',
      phoneE164: '+970599100081', recipientCountryCode: 'PS', expiresAt: Timestamp.fromMillis(Date.now() + 300_000),
    };
    await db().collection('relayJobs').doc('old-gen').set({ ...base, jobId: 'old-gen', policyVersion: 1 });
    await db().collection('relayJobs').doc('new-gen').set({ ...base, jobId: 'new-gen', policyVersion: 2 });
    await db().collection('smsConfig').doc('otp').set({ policyVersion: 2 }, { merge: true });
    const old = await waitFor(async () => {
      const d = (await db().collection('relayJobs').doc('old-gen').get()).data();
      return d?.status === 'failed' ? d : null;
    });
    expect(old).toMatchObject({ lastError: 'policy-changed' });
    expect(old.messageBody).toBeUndefined();
    expect((await db().collection('relayJobs').doc('new-gen').get()).get('status')).toBe('queued');
  });
});


// G7 rehearsal: HTTP callables + real emulator transactions/triggers.
// This suite is deliberately emulator-only. It is not a production runner,
// device test, signed-token proof or measurement of production contention.
describe('G7 dry run — budget path and stopped teardown over HTTP', () => {
  const device = () => db().collection('relayDevices').doc('dev-wire');
  const policy = () => db().collection('smsConfig').doc('otp');
  const phoneFor = (i: number) => '+97059910' + String(i).padStart(4, '0');
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let heartbeatError = false;

  beforeEach(async () => {
    await policy().set({
      enabled: true, emergencyStop: false, businessId: 'biz-g7', policyVersion: 1,
      signin: { enabled: true, attestation: 'off', limits: {
        powBits: 8, powMaxBits: 8, codeTtlSec: 600,
        sessionMaxCodes: 1, sessionCooldownSec: 30,
        sourceSessionsPerHour: 50, sourcePerHour: 50, sourcePerDay: 100,
        sourceDistinctDestinationsPerDay: 20,
        destinationCooldownSec: 30, destinationPerHour: 10, destinationPerDay: 20,
        globalPerHour: 50, globalPerDay: 100,
        installPerDay: 20, installDistinctDestinationsPerDay: 20,
      } },
      link: { enabled: false }, shared: { perHour: 50, perDay: 100 },
    });
    await device().set({
      businessId: 'biz-g7', status: 'active', lastHeartbeatAt: Timestamp.now(),
      countryRoutingEnabled: true, allowedCountryCodes: ['PS'], fcmToken: null,
      caps: { maxPerMinute: 0, maxPerHour: 0, maxPerDay: 0 },
    });
    heartbeatError = false;
    heartbeat = setInterval(() => {
      void device().update({ status: 'active', lastHeartbeatAt: Timestamp.now() })
        .catch(() => { heartbeatError = true; });
    }, 30_000);
    expect((await getAuth().listUsers()).users.length).toBe(0);
  });

  afterEach(async () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
    // Also runs when an assertion fails. This changes emulator data only.
    await policy().set({ emergencyStop: true, signin: { enabled: false } }, { merge: true });
    await waitFor(async () => {
      const jobs = await db().collection('relayJobs').get();
      return jobs.docs.every(d => d.get('status') === 'failed' && d.get('messageBody') === undefined);
    });
    await device().delete();
  });

  type Session = { sessionToken: string; pow: { nonce: string; bits: number } };
  async function session(installationId?: string): Promise<Session> {
    const r = await call('startPhoneAuth', installationId ? { installationId } : {});
    expect(r.error?.message, 'session setup must reach the handler').toBeUndefined();
    expect(typeof r.result?.sessionToken).toBe('string');
    return r.result as Session;
  }
  function payload(s: Session, phone: string, requestId: string) {
    return {
      sessionToken: s.sessionToken, phoneE164: phone, requestId,
      powNonce: s.pow.nonce, powSolution: solve(s.pow.nonce, phone, s.pow.bits),
    };
  }
  async function counters() {
    const snap = await db().collection('smsRateLimits').get();
    // Allowlisted evidence only: no session tokens, numbers, codes or bodies.
    return snap.docs.map(d => ({
      id: d.id, h: d.get('h') ?? null, d: d.get('d') ?? null,
      distinctCount: (d.get('nd')?.k as unknown[] | undefined)?.length ?? 0,
    })).sort((a, b) => a.id.localeCompare(b.id));
  }
  async function counts() {
    const names = ['smsRateLimits', 'phoneAuthSessions', 'phoneAuthChallenges', 'relayJobs'];
    return Object.fromEntries(await Promise.all(names.map(async name =>
      [name, (await db().collection(name).get()).size])));
  }
  async function jobEvidence() {
    return (await db().collection('relayJobs').get()).docs.map(d => ({
      id: d.id, status: d.get('status'), attempts: d.get('attempts'),
      lastError: d.get('lastError') ?? null,
      bodyPresent: d.get('messageBody') !== undefined,
    })).sort((a, b) => a.id.localeCompare(b.id));
  }
  async function assertBlockers() {
    expect(heartbeatError).toBe(false);
    const d = await device().get();
    expect(d.get('caps')).toEqual({ maxPerMinute: 0, maxPerHour: 0, maxPerDay: 0 });
    expect(d.get('usage')).toBeUndefined();
    expect(d.get('fcmToken')).toBeNull();
    expect((await getAuth().listUsers()).users.length).toBe(0);
  }
  async function stopAndEvidence() {
    await policy().set({ emergencyStop: true }, { merge: true });
    await waitFor(async () => {
      const jobs = await jobEvidence();
      return jobs.every(j => j.status === 'failed' && !j.bodyPresent);
    });
    const jobs = await jobEvidence();
    for (const j of jobs) {
      expect(j.attempts).toBe(0);
      expect(j.lastError).toBe('sending-stopped');
    }
    await assertBlockers();
    return jobs;
  }

  const switches: Array<[string, Record<string, unknown>, string]> = [
    ['master', { enabled: false }, 'phone-auth-unavailable'],
    ['emergency stop', { emergencyStop: true }, 'service-paused'],
    ['sender', { businessId: null }, 'service-paused'],
    ['sign-in', { signin: { enabled: false } }, 'phone-auth-unavailable'],
  ];
  // The deploy-time env-off case remains in the existing handler-level suite;
  // one running Functions emulator cannot change its process env per HTTP call.
  it.each(switches)('G7a: %s off refuses before writes', async (name, change, reason) => {
    await policy().set(change, { merge: true });
    const before = await counts();
    for (const fn of ['startPhoneAuth', 'requestPhoneAuthCode']) {
      const r = await call(fn, {});
      expect(r.error?.message).toBe(reason);
      expect(r.result).toBeUndefined();
    }
    const after = await counts();
    expect(after).toEqual(before);
    console.log('[G7 evidence]', JSON.stringify({
      layer: 'emulator-http', phase: 'policy-' + name, before, after, refusal: reason,
    }));
  });

  const phases = [
    { name: 'destination-cooldown', scope: 'destination', accepted: 1,
      limits: {}, shared: {}, sameNumber: true, sameInstall: false },
    { name: 'source-hour', scope: 'source', accepted: 3,
      limits: { sourcePerHour: 3 }, shared: {}, sameNumber: false, sameInstall: false },
    { name: 'global-hour', scope: 'global', accepted: 3,
      limits: { globalPerHour: 3 }, shared: {}, sameNumber: false, sameInstall: false },
    { name: 'shared-hour', scope: 'global', accepted: 3,
      limits: {}, shared: { perHour: 3 }, sameNumber: false, sameInstall: false },
    { name: 'installation-day', scope: 'installation', accepted: 3,
      limits: { installPerDay: 3 }, shared: {}, sameNumber: false, sameInstall: true },
  ];

  it.each(phases)('G7b: $name holds during parallel requests and replay', async phase => {
    const overrides = Object.fromEntries([
      ...Object.entries(phase.limits).map(([key, value]) => ['signin.limits.' + key, value]),
      ...Object.entries(phase.shared).map(([key, value]) => ['shared.' + key, value]),
    ]);
    if (Object.keys(overrides).length) await policy().update(overrides);
    const effectivePolicy = (await policy().get()).data()!;
    const inputs: Array<ReturnType<typeof payload>> = [];
    for (let i = 0; i < 8; i++) {
      const s = await session(phase.sameInstall ? 'g7-installation-00000001' : undefined);
      inputs.push(payload(s, phoneFor(phase.sameNumber ? 0 : i), 'g7-' + phase.name + '-' + i));
    }
    const before = await counters();
    const responses: Array<Awaited<ReturnType<typeof call>>> = [];
    // At most four in flight; no automatic retries or unbounded load.
    for (let i = 0; i < inputs.length; i += 4) {
      responses.push(...await Promise.all(inputs.slice(i, i + 4)
        .map(data => call('requestPhoneAuthCode', data))));
    }
    const accepted = responses.filter(r => r.result !== undefined);
    const refused = responses.filter(r => r.error !== undefined);
    expect(accepted.length).toBe(phase.accepted);
    expect(refused.length).toBe(8 - phase.accepted);
    for (const r of refused) {
      expect(r.error?.status).toBe('RESOURCE_EXHAUSTED');
      expect(r.error?.details?.scope).toBe(phase.scope);
      expect(['cooldown', 'service-busy', 'rate-limited']).toContain(r.error?.message);
    }

    const acceptedIndex = responses.findIndex(r => r.result !== undefined);
    const replay = await call('requestPhoneAuthCode', inputs[acceptedIndex]);
    expect(replay.error?.message).toBeUndefined();
    expect(replay.result?.replayed).toBe(true);
    expect(replay.result?.challengeId).toBe(responses[acceptedIndex].result.challengeId);

    const after = await counters();
    for (const id of ['global_phoneAuth', 'global_verification']) {
      const start = before.find(c => c.id === id)?.h?.c ?? 0;
      expect((after.find(c => c.id === id)?.h?.c ?? 0) - start).toBe(phase.accepted);
    }
    for (const c of after) {
      if (c.id.startsWith('dest_')) expect(c.h.c).toBeLessThanOrEqual(effectivePolicy.signin.limits.destinationPerHour);
      if (c.id.startsWith('asrc_')) expect(c.h.c).toBeLessThanOrEqual(effectivePolicy.signin.limits.sourcePerHour);
      if (c.id.startsWith('ainst_')) expect(c.d.c).toBeLessThanOrEqual(effectivePolicy.signin.limits.installPerDay);
    }
    const queued = await jobEvidence();
    expect(queued.length).toBe(phase.accepted);
    expect((await db().collection('phoneAuthChallenges').get()).size).toBe(phase.accepted);
    for (const j of queued) {
      expect(j.status).toBe('queued');
      expect(j.attempts).toBe(0);
    }
    await assertBlockers();
    const terminal = await stopAndEvidence();
    console.log('[G7 evidence]', JSON.stringify({
      layer: 'emulator-http', phase: phase.name, requests: 8,
      uniqueAccepted: accepted.length, replays: 1,
      refusalTally: refused.reduce<Record<string, number>>((out, r) => {
        const key = r.error!.message + ':' + r.error!.details.scope;
        out[key] = (out[key] ?? 0) + 1; return out;
      }, {}),
      before, after, queued, terminal,
    }));
  });

  it('G7b: session maximum is observed after its cooldown expires', async () => {
    const s = await session();
    const first = await call('requestPhoneAuthCode', payload(s, phoneFor(10), 'g7-session-first'));
    expect(first.error?.message).toBeUndefined();
    expect(typeof first.result?.challengeId).toBe('string');
    const early = await call('requestPhoneAuthCode',
      payload({ ...s, pow: first.result.pow }, phoneFor(11), 'g7-session-early'));
    expect(early.error?.message).toBe('cooldown');
    expect(early.error?.details?.scope).toBe('session');
    const before = await counters();
    // Real wall clock: do not fabricate server-side session/counter timestamps.
    await new Promise(resolve => setTimeout(resolve, 31_000));
    const exhausted = await call('requestPhoneAuthCode',
      payload({ ...s, pow: early.error!.details.pow }, phoneFor(11), 'g7-session-exhausted'));
    expect(exhausted.error?.message).toBe('session-exhausted');
    expect(exhausted.error?.details?.scope).toBe('session');
    const after = await counters();
    expect(after).toEqual(before);
    expect((await db().collection('relayJobs').get()).size).toBe(1);
    const terminal = await stopAndEvidence();
    console.log('[G7 evidence]', JSON.stringify({
      layer: 'emulator-http', phase: 'session-after-cooldown',
      uniqueAccepted: 1, refusals: ['cooldown:session', 'session-exhausted:session'],
      before, after, terminal,
    }));
  });
});
