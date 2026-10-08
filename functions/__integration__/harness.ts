// Shared harness for the emulator-backed phone-link / SMS-abuse tests.
// Env (emulator hosts, test pepper, PHONE_LINK_ENABLED) comes from
// vitest.integration.config.ts so it is set before firebase-admin loads.

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { expect } from 'vitest';

export const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-offlinesms';
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  // Hard stop: these tests must never run against a real project.
  throw new Error('integration tests require the Firestore + Auth emulators');
}
if (getApps().length === 0) initializeApp({ projectId: PROJECT });

export const db = () => getFirestore();
export const BUSINESS = 'biz-verify';
export const DEVICE = 'relay-dev-1';

/** Numbers in a reserved-looking PS mobile range; only ever written to the emulator. */
export const num = (n: number) => `+9705991${String(n).padStart(5, '0')}`;

export async function resetEmulators(): Promise<void> {
  const fs = process.env.FIRESTORE_EMULATOR_HOST;
  const au = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const r1 = await fetch(`http://${fs}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const r2 = await fetch(`http://${au}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  if (!r1.ok || !r2.ok) throw new Error(`emulator reset failed: ${r1.status}/${r2.status}`);
}

/** Seed smsConfig/otp (the shared verification policy) with both purposes on. */
export async function seedPolicy(over: Record<string, unknown> = {}): Promise<void> {
  await db().collection('smsConfig').doc('otp').set({
    enabled: true, emergencyStop: false, businessId: BUSINESS, policyVersion: 1,
    signin: { enabled: true }, link: { enabled: true },
    ...over,
  });
}

/** Back-compat for the link suites: `limits`/`enabled` map to the `link` section. */
export async function seedPhoneLinkConfig(over: Record<string, unknown> = {}): Promise<void> {
  const { limits, enabled, ...rest } = over as { limits?: unknown; enabled?: boolean };
  await seedPolicy({ ...rest, link: { enabled: enabled ?? true, ...(limits ? { limits } : {}) } });
}

export async function seedRelayDevice(country = 'PS'): Promise<void> {
  await db().collection('relayDevices').doc(DEVICE).set({
    businessId: BUSINESS, status: 'active',
    lastHeartbeatAt: Timestamp.fromMillis(Date.now()),
    countryRoutingEnabled: true, allowedCountryCodes: [country],
    caps: { maxPerMinute: 1000, maxPerHour: 10_000, maxPerDay: 10_000 }, counters: { sentToday: 0 },
  });
}

let seq = 0;
export interface TestUser { uid: string; email: string }

/** An email-OTP style account with profile, wallet and one group membership. */
export async function makeEmailUser(opts: {
  emailVerified?: boolean; disabled?: boolean; status?: string | null; phoneNumber?: string;
} = {}): Promise<TestUser> {
  seq++;
  const email = `user${seq}-${Date.now()}@example.test`;
  const u = await getAuth().createUser({
    email, emailVerified: opts.emailVerified ?? true, disabled: opts.disabled ?? false,
    ...(opts.phoneNumber ? { phoneNumber: opts.phoneNumber } : {}),
  });
  const profile: Record<string, unknown> = {
    displayName: `User ${seq}`, username: `user${seq}`, usernameLower: `user${seq}`,
    profileCompleted: true, createdAt: Timestamp.fromMillis(1_700_000_000_000),
  };
  if (opts.status !== null) profile.status = opts.status ?? 'active';
  await db().collection('users').doc(u.uid).set(profile);
  await db().collection('users').doc(u.uid).collection('userPrivate').doc('profile').set({
    email, ...(opts.phoneNumber ? { phoneNumber: opts.phoneNumber } : {}),
  });
  await db().collection('wallets').doc(u.uid).set({ balance: 50, reserved: 0 });
  await db().collection('conversations').doc(`grp-${u.uid}`).set({
    type: 'group', participantUids: [u.uid, 'peer-1'], name: 'G',
  });
  await db().collection('conversations').doc(`grp-${u.uid}`).collection('members').doc(u.uid).set({ role: 'member', status: 'active' });
  return { uid: u.uid, email };
}

export interface ReqOpts {
  authAgeSec?: number; provider?: string; ip?: string; xff?: string;
  claims?: Record<string, unknown>; noAuth?: boolean; app?: boolean;
}

/** Build the CallableRequest the functions framework would pass the handler
 *  after verifying the ID token (token verification itself is Firebase's). */
export function req(uid: string | null, data: unknown, o: ReqOpts = {}): CallableRequest<unknown> {
  const nowSec = Math.floor(Date.now() / 1000);
  const ip = o.ip ?? '203.0.113.10';
  return {
    data,
    rawRequest: { headers: { 'x-forwarded-for': o.xff ?? ip }, ip } as never,
    acceptsStreaming: false,
    ...(o.app ? { app: { appId: 'test-app', token: {} as never } } : {}),
    ...(uid && !o.noAuth ? {
      auth: {
        uid,
        rawToken: 'test',
        token: {
          uid, sub: uid, aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`,
          auth_time: nowSec - (o.authAgeSec ?? 5), iat: nowSec, exp: nowSec + 3600,
          firebase: { sign_in_provider: o.provider ?? 'custom', identities: {} },
          ...(o.claims ?? {}),
        } as never,
      },
    } : {}),
  } as CallableRequest<unknown>;
}

export const CONSENT = { ownershipConfirmed: true, smsConsent: true, consentVersion: 'phone-link-v1' };
export const linkReq = (phoneE164: string, extra: Record<string, unknown> = {}) => ({ phoneE164, ...CONSENT, ...extra });

export async function expectHttps(p: Promise<unknown>, code: string, message?: string): Promise<HttpsError> {
  let err: unknown;
  try { await p; } catch (e) { err = e; }
  expect(err, `expected HttpsError ${code}/${message ?? ''}`).toBeInstanceOf(HttpsError);
  const he = err as HttpsError;
  expect(he.code).toBe(code);
  if (message) expect(he.message).toBe(message);
  return he;
}

export async function relayJobs(kind?: string) {
  const q = kind ? db().collection('relayJobs').where('kind', '==', kind) : db().collection('relayJobs');
  return (await q.get()).docs;
}

/** The 6-digit code a relay phone would have texted for a challenge. */
export async function deliveredCode(challengeId: string, prefix = 'plink'): Promise<string> {
  const job = await db().collection('relayJobs').doc(`${prefix}_${challengeId}`).get();
  const m = /\b(\d{6})\b/.exec((job.get('messageBody') as string) ?? '');
  if (!m) throw new Error('no code in job body');
  return m[1];
}

/** Everything that must NOT change on a rejected operation. */
export async function sideEffectSnapshot(uid: string) {
  const [jobs, claims, ops, user, priv, wallet, auth] = await Promise.all([
    db().collection('relayJobs').get(),
    db().collection('phoneClaims').get(),
    db().collection('phoneLinkOps').get(),
    db().collection('users').doc(uid).get(),
    db().collection('users').doc(uid).collection('userPrivate').doc('profile').get(),
    db().collection('wallets').doc(uid).get(),
    getAuth().getUser(uid),
  ]);
  return {
    relayJobs: jobs.size,
    claims: claims.size,
    ops: ops.size,
    phoneVerified: user.get('phoneVerified') ?? null,
    privatePhone: priv.get('phoneNumber') ?? null,
    balance: wallet.get('balance'),
    authPhone: auth.phoneNumber ?? null,
  };
}

export async function authUserCount(): Promise<number> {
  return (await getAuth().listUsers(1000)).users.length;
}

/** Relay-device request (custom-token claims a paired phone carries). Current
 *  relay builds declare the send-authorization capability; pass `caps: []` to
 *  act as an older build. */
export function deviceReq(data: Record<string, unknown>, deviceId = DEVICE): CallableRequest<unknown> {
  return req(deviceId, { deviceId, clientCaps: ['send-auth-v1', 'attempt-v1'], ...data }, {
    claims: { relayDevice: true, deviceId, businessId: BUSINESS },
  });
}

/** Read a job's current server state. */
export async function job(id: string) {
  return (await db().collection('relayJobs').doc(id).get()).data() ?? null;
}

export { Timestamp, FieldValue };
