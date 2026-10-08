// Wire-level tests: raw HTTP calls to the deployed-shape callables in the
// Functions emulator. Proves that direct HTTP clients (not the app) hit the same
// server gates, and exercises the framework's real ID-token verification.
// Limits of this layer: the emulator does not enforce App Check, has no Google
// front end (so X-Forwarded-For is whatever the client sends), and sends no SMS.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { createHash } from 'node:crypto';

const PROJECT = 'demo-offlinesms';
const FN = (name: string) => `http://127.0.0.1:5001/${PROJECT}/us-central1/${name}`;
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulators required');
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
