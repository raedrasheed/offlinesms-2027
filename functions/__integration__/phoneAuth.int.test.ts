// Protected PUBLIC phone sign-in / sign-up — adversarial tests through the real
// handlers on the Firestore + Auth emulators (layer: direct handler invocation;
// the functions framework's own token/App Check parsing is covered separately
// by callable.int.test.ts). Codes are read from the queued relay job (the
// mocked SMS) — nothing is sent, no real number is contacted.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from 'firebase-admin/auth';
import { createHash, randomBytes } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  db, resetEmulators, seedPolicy, seedRelayDevice, req, expectHttps, relayJobs, deliveredCode,
  authUserCount, num, makeEmailUser, linkReq, type ReqOpts,
} from './harness';
import { handleStartPhoneAuth } from '../src/phoneAuth/startPhoneAuth';
import { handleRequestPhoneAuthCode } from '../src/phoneAuth/requestPhoneAuthCode';
import { handleVerifyPhoneAuthCode, phoneAuthDeps } from '../src/phoneAuth/verifyPhoneAuthCode';
import { handleRequestPhoneLinkOtp } from '../src/phoneLink/requestPhoneLinkOtp';
import { solvePow } from '../src/phoneAuth/pow';

type Pow = { nonce: string; bits: number; expiresAtMs: number };
interface Sess { sessionToken: string; expiresAtMs: number; pow: Pow; ip: string }

const FAST = { powBits: 8, powMaxBits: 8 };
const rid = () => randomBytes(12).toString('base64url');

async function start(o: { ip?: string; inst?: string | null; app?: boolean } = {}): Promise<Sess> {
  const ip = o.ip ?? '203.0.113.10';
  const data = o.inst === null ? {} : { installationId: o.inst ?? 'install-' + rid() };
  const r = await handleStartPhoneAuth(req(null, data, { ip, app: o.app })) as Omit<Sess, 'ip'>;
  return { ...r, ip };
}

/** Solve the session's proof for `phone` and request a code. Keeps sess.pow fresh. */
async function send(sess: Sess, phone: string, o: { requestId?: string; ip?: string; xff?: string; solution?: string; nonce?: string; purpose?: unknown } = {}) {
  const solution = o.solution ?? solvePow(sess.pow.nonce, phone, sess.pow.bits)!;
  const data: Record<string, unknown> = {
    sessionToken: sess.sessionToken, phoneE164: phone,
    powNonce: o.nonce ?? sess.pow.nonce, powSolution: solution, requestId: o.requestId ?? rid(),
  };
  if (o.purpose !== undefined) data.purpose = o.purpose;
  const ro: ReqOpts = { ip: o.ip ?? sess.ip, ...(o.xff ? { xff: o.xff } : {}) };
  try {
    const r = await handleRequestPhoneAuthCode(req(null, data, ro)) as { challengeId: string; pow: Pow; replayed?: boolean; resendAfterSec: number; maskedPhone: string };
    sess.pow = r.pow;
    return r;
  } catch (e) {
    const p = (e as HttpsError).details as { pow?: Pow } | undefined;
    if (p?.pow) sess.pow = p.pow;
    throw e;
  }
}

const verify = (sess: Sess, challengeId: string, code: string) =>
  handleVerifyPhoneAuthCode(req(null, { sessionToken: sess.sessionToken, challengeId, code })) as Promise<{ customToken: string; uid: string; isNewUser: boolean }>;
const code = (challengeId: string) => deliveredCode(challengeId, 'pauth');
const wrong = (c: string) => (c === '000000' ? '111111' : '000000');
const authJobs = async () => (await relayJobs('phone_auth_otp')).length;

async function advance(ms: number) {
  vi.setSystemTime(Date.now() + ms);
  await seedRelayDevice();
}

const deps = { ...phoneAuthDeps };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  await resetEmulators();
  await seedPolicy({ signin: { enabled: true, limits: FAST } });
  await seedRelayDevice();
  process.env.PHONE_AUTH_ENABLED = 'true';
});
afterEach(() => {
  vi.useRealTimers();
  Object.assign(phoneAuthDeps, deps);
  process.env.PHONE_AUTH_ENABLED = 'true';
});

// ── A ─────────────────────────────────────────────────────────────────────
describe('A — legitimate new and existing users', () => {
  it('a new person with no account signs up by phone (account, profile, 50-pt wallet, private phone)', async () => {
    const before = await authUserCount();
    const s = await start();
    const r = await send(s, num(1));
    const res = await verify(s, r.challengeId, await code(r.challengeId));
    expect(res.isNewUser).toBe(true);
    expect(res.customToken).toBeTruthy();
    expect(await authUserCount()).toBe(before + 1);
    expect((await getAuth().getUser(res.uid)).phoneNumber).toBe(num(1));
    const prof = (await db().collection('users').doc(res.uid).get()).data()!;
    expect(prof).toMatchObject({ status: 'active', phoneVerified: true, profileCompleted: false });
    expect(JSON.stringify(prof)).not.toContain('599100001');
    expect((await db().collection('wallets').doc(res.uid).get()).get('balance')).toBe(50);
    expect((await db().collection('users').doc(res.uid).collection('userPrivate').doc('profile').get()).get('phoneNumber')).toBe(num(1));
  });

  it('an existing phone-only account signs back in to the SAME uid, data untouched', async () => {
    const legacy = await getAuth().createUser({ phoneNumber: num(2) });
    await db().collection('users').doc(legacy.uid).set({ displayName: 'Old', status: 'active', createdAt: new Date(0) });
    await db().collection('wallets').doc(legacy.uid).set({ balance: 120, reserved: 0 });
    const before = await authUserCount();
    const s = await start();
    const r = await send(s, num(2));
    const res = await verify(s, r.challengeId, await code(r.challengeId));
    expect(res).toMatchObject({ uid: legacy.uid, isNewUser: false });
    expect(await authUserCount()).toBe(before);
    expect((await db().collection('wallets').doc(legacy.uid).get()).get('balance')).toBe(120);
    expect((await db().collection('users').doc(legacy.uid).get()).get('displayName')).toBe('Old');
  });

  it('a number linked to an email account signs into that account (no new account)', async () => {
    const u = await makeEmailUser({ phoneNumber: num(3) });
    const s = await start();
    const r = await send(s, num(3));
    expect(await verify(s, r.challengeId, await code(r.challengeId))).toMatchObject({ uid: u.uid, isNewUser: false });
  });

  it('a disabled or suspended account cannot sign in, and nothing changes', async () => {
    const d = await getAuth().createUser({ phoneNumber: num(4), disabled: true });
    let s = await start();
    let r = await send(s, num(4));
    await expectHttps(verify(s, r.challengeId, await code(r.challengeId)), 'permission-denied', 'account-disabled');
    expect((await db().collection('wallets').doc(d.uid).get()).exists).toBe(false);
    const sus = await getAuth().createUser({ phoneNumber: num(5) });
    await db().collection('users').doc(sus.uid).set({ status: 'suspended' });
    s = await start({ ip: '203.0.113.11' });
    r = await send(s, num(5));
    await expectHttps(verify(s, r.challengeId, await code(r.challengeId)), 'permission-denied', 'account-disabled');
  });
});

// ── B ─────────────────────────────────────────────────────────────────────
describe('B — the proof-of-work gate (missing / invalid / expired / replayed)', () => {
  it('missing, wrong, stale, re-used, cross-number and expired proofs never queue an SMS', async () => {
    const s = await start();
    await expectHttps(send(s, num(10), { solution: '' }), 'permission-denied', 'proof-invalid');
    await expectHttps(send(s, num(10), { solution: 'x1' }), 'permission-denied', 'proof-invalid');
    // A solution for another number does not transfer.
    const forOther = solvePow(s.pow.nonce, num(11), s.pow.bits)!;
    const badFor10 = createHash('sha256').update(`pow:v1:${s.pow.nonce}:${num(10)}:${forOther}`).digest()[0] === 0;
    if (!badFor10) await expectHttps(send(s, num(10), { solution: forOther }), 'permission-denied', 'proof-invalid');
    // A nonce from before rotation is dead.
    const stale = { ...s.pow };
    await expectHttps(send(s, num(10), { solution: '' }), 'permission-denied', 'proof-invalid');
    await expectHttps(send(s, num(10), { nonce: stale.nonce, solution: solvePow(stale.nonce, num(10), stale.bits)! }), 'permission-denied', 'proof-invalid');
    expect(await authJobs()).toBe(0);
    // A valid proof works once; the same proof with a new requestId does not.
    const proof = { nonce: s.pow.nonce, solution: solvePow(s.pow.nonce, num(10), s.pow.bits)! };
    await send(s, num(10), proof);
    await advance(61_000);
    await expectHttps(send(s, num(10), proof), 'permission-denied', 'proof-invalid');
    expect(await authJobs()).toBe(1);
    // An expired proof (session still alive) is refused.
    const s2 = await start({ ip: '203.0.113.12' });
    await advance(601_000);
    await expectHttps(send(s2, num(12)), 'permission-denied', 'proof-invalid');
    expect(await authJobs()).toBe(1);
  });

  it('no session, forged or expired session tokens are refused before any work', async () => {
    const data = (token: unknown) => ({ sessionToken: token, phoneE164: num(13), powNonce: 'a', powSolution: '1', requestId: rid() });
    await expectHttps(handleRequestPhoneAuthCode(req(null, data(undefined))), 'failed-precondition', 'session-expired');
    await expectHttps(handleRequestPhoneAuthCode(req(null, data('A'.repeat(43)))), 'failed-precondition', 'session-expired');
    const s = await start();
    await advance(1_801_000);
    await expectHttps(send(s, num(13)), 'failed-precondition', 'session-expired');
    expect(await authJobs()).toBe(0);
  });

  it('App Check can be REQUIRED by policy (and a consumed token is refused)', async () => {
    await seedPolicy({ signin: { enabled: true, limits: FAST, attestation: 'required' } });
    await expectHttps(handleStartPhoneAuth(req(null, {})), 'failed-precondition', 'attestation-required');
    const consumed = { ...req(null, {}), app: { appId: 'a', token: {} as never, alreadyConsumed: true } };
    await expectHttps(handleStartPhoneAuth(consumed as never), 'failed-precondition', 'attestation-required');
    const s = await start({ app: true });
    await expectHttps(send(s, num(14)), 'failed-precondition', 'attestation-required'); // request without token
    expect(await authJobs()).toBe(0);
  });

  it('purpose is fixed: link/other purposes are refused on the public endpoint', async () => {
    const s = await start();
    for (const purpose of ['link', 'register', '', null]) {
      await expectHttps(send(s, num(15), { purpose }), 'invalid-argument', 'purpose-invalid');
    }
    expect(await authJobs()).toBe(0);
  });
});

// ── C ─────────────────────────────────────────────────────────────────────
describe('C — spraying: many numbers from one requester, many requesters at one number', () => {
  it('one session: few codes, few numbers; a fresh session hits the installation, then the source', async () => {
    await seedPolicy({ signin: { enabled: true, limits: { ...FAST, sourceDistinctDestinationsPerDay: 4 } } });
    const inst = 'install-fixed-0001';
    const s1 = await start({ inst });
    await send(s1, num(20)); await advance(61_000);
    await send(s1, num(21)); await advance(61_000);
    await expectHttps(send(s1, num(22)), 'resource-exhausted', 'too-many-numbers'); // session: 2 numbers
    const s2 = await start({ inst });
    await send(s2, num(22)); await advance(61_000);
    await expectHttps(send(s2, num(23)), 'resource-exhausted', 'too-many-numbers'); // installation: 3/day
    // Reinstall (new installation id) — the source still remembers.
    const s3 = await start({ inst: 'install-reset-0002' });
    await send(s3, num(23)); await advance(61_000);
    await expectHttps(send(s3, num(24)), 'resource-exhausted', 'too-many-numbers'); // source: 4/day
    // No installation id at all — still the source.
    const s4 = await start({ inst: null });
    await expectHttps(send(s4, num(25)), 'resource-exhausted', 'too-many-numbers');
    expect(await authJobs()).toBe(4);
  });

  it('many sources at one victim number: destination cooldown + hourly cap', async () => {
    const victim = num(30);
    const sess = await Promise.all([1, 2, 3, 4, 5].map(i => start({ ip: `198.51.100.${i}` })));
    await send(sess[0], victim);
    await expectHttps(send(sess[1], victim), 'resource-exhausted', 'cooldown');
    await advance(61_000); await send(sess[2], victim);
    await advance(61_000); await send(sess[3], victim);
    await advance(61_000);
    await expectHttps(send(sess[4], victim), 'resource-exhausted', 'rate-limited');
    expect(await authJobs()).toBe(3);
  });

  it('spoofed X-Forwarded-For prefixes and IPv6 interface ids share one source bucket', async () => {
    await seedPolicy({ signin: { enabled: true, limits: { ...FAST, sourcePerHour: 2 } } });
    const a = await start({ ip: '2001:db8:7:7::1' });
    const b = await start({ ip: '2001:db8:7:7::2' });
    const c = await start({ ip: '2001:db8:7:7::3' });
    await send(a, num(40));
    await send(b, num(41), { ip: '2001:db8:7:7:aaaa::9' });
    await expectHttps(send(c, num(42), { xff: '10.0.0.1, 2001:db8:7:7:ffff::1' }), 'resource-exhausted', 'service-busy');
    expect(await authJobs()).toBe(2);
  });

  it('the sign-in budget and the budget shared with phone linking are global ceilings', async () => {
    await seedPolicy({ signin: { enabled: true, limits: { ...FAST, globalPerHour: 2 } } });
    const ss = await Promise.all([1, 2, 3].map(i => start({ ip: `192.0.2.${i}` })));
    await send(ss[0], num(50)); await send(ss[1], num(51));
    await expectHttps(send(ss[2], num(52)), 'resource-exhausted', 'service-busy');
    // Shared with linking.
    await resetEmulators();
    await seedPolicy({ signin: { enabled: true, limits: FAST }, shared: { perHour: 2 } });
    await seedRelayDevice();
    const u = await makeEmailUser();
    await handleRequestPhoneLinkOtp(req(u.uid, linkReq(num(53))));
    const s = await start({ ip: '192.0.2.9' });
    await send(s, num(54));
    const s2 = await start({ ip: '192.0.2.10' });
    await expectHttps(send(s2, num(55)), 'resource-exhausted', 'service-busy');
  });

  it('opening sessions is itself limited per source', async () => {
    await seedPolicy({ signin: { enabled: true, limits: { ...FAST, sourceSessionsPerHour: 2 } } });
    await start({ ip: '198.51.100.77' }); await start({ ip: '198.51.100.77' });
    await expectHttps(start({ ip: '198.51.100.77' }), 'resource-exhausted', 'service-busy');
  });
});

// ── D ─────────────────────────────────────────────────────────────────────
describe('D — concurrency, idempotency, and budgets that survive verification', () => {
  it('15 parallel requests with one proof → exactly one SMS', async () => {
    const s = await start();
    const proof = { nonce: s.pow.nonce, solution: solvePow(s.pow.nonce, num(60), s.pow.bits)! };
    const rs = await Promise.allSettled(Array.from({ length: 15 }, () => send({ ...s, pow: { ...s.pow } }, num(60), proof)));
    expect(rs.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await authJobs()).toBe(1);
  });

  it('parallel sessions never overshoot the global budget', async () => {
    await seedPolicy({ signin: { enabled: true, limits: { ...FAST, globalPerHour: 3 } } });
    const ss = await Promise.all(Array.from({ length: 10 }, (_, i) => start({ ip: `198.51.100.${100 + i}` })));
    const rs = await Promise.allSettled(ss.map((s, i) => send(s, num(70 + i))));
    const ok = rs.filter(r => r.status === 'fulfilled').length;
    expect(await authJobs()).toBe(ok);
    expect(ok).toBeLessThanOrEqual(3);
    expect(ok).toBeGreaterThanOrEqual(1);
  });

  it('a lost-response retry with the same requestId returns the original result, never a 2nd SMS', async () => {
    const s = await start();
    const requestId = rid();
    const proof = { nonce: s.pow.nonce, solution: solvePow(s.pow.nonce, num(80), s.pow.bits)! };
    const first = await send({ ...s }, num(80), { ...proof, requestId });
    const again = await send({ ...s }, num(80), { ...proof, requestId });
    expect(again.challengeId).toBe(first.challengeId);
    expect(again.replayed).toBe(true);
    await expectHttps(send({ ...s }, num(81), { ...proof, requestId }), 'failed-precondition', 'request-conflict');
    expect(await authJobs()).toBe(1);
  });

  it('a successful sign-in does not reset the destination budget', async () => {
    const s = await start();
    const r = await send(s, num(90));
    await verify(s, r.challengeId, await code(r.challengeId));
    const s2 = await start({ ip: '203.0.113.50' });
    await expectHttps(send(s2, num(90)), 'resource-exhausted', 'cooldown');
    await advance(61_000); await send(s2, num(90));
    const s3 = await start({ ip: '203.0.113.51' });
    await advance(61_000); await send(s3, num(90));
    const s4 = await start({ ip: '203.0.113.52' });
    await advance(61_000);
    await expectHttps(send(s4, num(90)), 'resource-exhausted', 'rate-limited');
  });
});

// ── A06 / A07 ─────────────────────────────────────────────────────────────
describe('guessing, isolation and replay', () => {
  it('wrong guesses are bounded per destination ACROSS challenges and sessions', async () => {
    await seedPolicy({ signin: { enabled: true, limits: { ...FAST, maxVerifyAttempts: 2, destinationVerifyFailuresPerDay: 3 } } });
    const s = await start();
    const r1 = await send(s, num(100));
    const c1 = await code(r1.challengeId);
    await expectHttps(verify(s, r1.challengeId, wrong(c1)), 'permission-denied', 'code-invalid');
    await expectHttps(verify(s, r1.challengeId, wrong(c1)), 'resource-exhausted', 'too-many-attempts');
    await advance(61_000);
    const s2 = await start({ ip: '203.0.113.60' });
    const r2 = await send(s2, num(100));
    const c2 = await code(r2.challengeId);
    await expectHttps(verify(s2, r2.challengeId, wrong(c2)), 'permission-denied', 'code-invalid');
    await expectHttps(verify(s2, r2.challengeId, c2), 'resource-exhausted', 'too-many-attempts');
  });

  it("another session can't use, guess against, or burn someone's challenge", async () => {
    const victim = await start();
    const r = await send(victim, num(110));
    const c = await code(r.challengeId);
    const attacker = await start({ ip: '198.51.100.200' });
    for (let i = 0; i < 6; i++) await expectHttps(verify(attacker, r.challengeId, String(i).padStart(6, '0')), 'not-found', 'challenge-not-found');
    expect((await db().collection('phoneAuthChallenges').doc(r.challengeId).get()).get('attempts')).toBe(0);
    await expectHttps(verify(attacker, r.challengeId, c), 'not-found', 'challenge-not-found');
    expect((await verify(victim, r.challengeId, c)).isNewUser).toBe(true);
  });

  it('a newer code supersedes the older one; expired codes fail; replay only re-issues to the same session briefly', async () => {
    const s = await start();
    const r1 = await send(s, num(120));
    const c1 = await code(r1.challengeId);
    await advance(61_000);
    const r2 = await send(s, num(120));
    expect((await db().collection('relayJobs').doc(`pauth_${r1.challengeId}`).get()).get('lastError')).toBe('superseded');
    await expectHttps(verify(s, r1.challengeId, c1), 'not-found', 'challenge-not-found');
    const c2 = await code(r2.challengeId);
    const first = await verify(s, r2.challengeId, c2);
    const users = await authUserCount();
    const again = await verify(s, r2.challengeId, '999999'); // lost response → same account
    expect(again.uid).toBe(first.uid);
    expect(await authUserCount()).toBe(users);
    expect((await db().collection('wallets').doc(first.uid).get()).get('balance')).toBe(50);
    await advance(601_000);
    await expectHttps(verify(s, r2.challengeId, c2), 'not-found', 'challenge-not-found');
    const s3 = await start({ ip: '203.0.113.70' });
    const r3 = await send(s3, num(121));
    await advance(301_000);
    await expectHttps(verify(s3, r3.challengeId, await code(r3.challengeId)), 'deadline-exceeded', 'code-expired');
  });
});

// ── A08 ───────────────────────────────────────────────────────────────────
describe('A08 — interruptions during account completion', () => {
  async function verified(n: number) {
    const s = await start({ ip: `203.0.113.${100 + n}` });
    const r = await send(s, num(n));
    return { s, r, c: await code(r.challengeId) };
  }

  it('crash right after createUser: retry recognises the planned uid, one account, one welcome credit', async () => {
    const { s, r, c } = await verified(130);
    phoneAuthDeps.createUser = async (uid, e164) => { await deps.createUser(uid, e164); throw Object.assign(new Error('socket hang up'), { code: 'app/network-error' }); };
    const before = await authUserCount();
    await expectHttps(verify(s, r.challengeId, c), 'unavailable', 'signin-interrupted');
    phoneAuthDeps.createUser = deps.createUser;
    const res = await verify(s, r.challengeId, c);
    expect(res.isNewUser).toBe(true);
    expect(await authUserCount()).toBe(before + 1);
    expect((await db().collection('wallets').doc(res.uid).get()).get('balance')).toBe(50);
  });

  it('failure before profile/wallet writes, and before token return, are both resumable', async () => {
    const { s, r, c } = await verified(131);
    phoneAuthDeps.beforeBootstrap = async () => { throw new Error('deadline'); };
    await expectHttps(verify(s, r.challengeId, c), 'unavailable', 'signin-interrupted');
    phoneAuthDeps.beforeBootstrap = deps.beforeBootstrap;
    phoneAuthDeps.mintToken = async () => { throw new Error('iam unavailable'); };
    await expectHttps(verify(s, r.challengeId, c), 'unavailable', 'signin-interrupted');
    phoneAuthDeps.mintToken = deps.mintToken;
    const res = await verify(s, r.challengeId, c);
    expect((await db().collection('wallets').doc(res.uid).get()).data()).toMatchObject({ balance: 50 });
    expect((await db().collection('phoneAuthOps').doc(r.challengeId).get()).get('stage')).toBe('done');
  });

  it('an Auth lookup error that is NOT user-not-found never creates an account', async () => {
    const { s, r, c } = await verified(132);
    phoneAuthDeps.getUserByPhone = async () => { throw Object.assign(new Error('internal'), { code: 'auth/internal-error' }); };
    const before = await authUserCount();
    await expectHttps(verify(s, r.challengeId, c), 'unavailable', 'signin-interrupted');
    expect(await authUserCount()).toBe(before);
  });

  it('parallel verifications of one code create exactly one account', async () => {
    const { s, r, c } = await verified(133);
    const before = await authUserCount();
    const rs = await Promise.allSettled(Array.from({ length: 5 }, () => verify(s, r.challengeId, c)));
    const uids = new Set(rs.filter(x => x.status === 'fulfilled').map(x => (x as PromiseFulfilledResult<{ uid: string }>).value.uid));
    expect(uids.size).toBe(1);
    expect(await authUserCount()).toBe(before + 1);
  });
});

// ── A17 / N1 / N2 ─────────────────────────────────────────────────────────
describe('A17 + N2 — store-review access: designated demo only, no phone side effects', () => {
  const REVIEW = num(140);
  const CODE = '246810';
  let reviewCfg: Record<string, unknown> = {};
  async function enableReview(uid: string, over: Record<string, unknown> = {}, keepSalt = false) {
    const codeSalt = keepSalt && reviewCfg.codeSalt ? reviewCfg.codeSalt as string : randomBytes(16).toString('hex');
    const codeHash = createHash('sha256').update(`${codeSalt}:${over.code ?? CODE}`).digest('hex');
    const { code: _c, ...rest } = over;
    reviewCfg = { enabled: true, phoneE164: REVIEW, codeSalt, codeHash, uid, expiresAtMs: Date.now() + 86_400_000, ...rest };
    await seedPolicy({ signin: { enabled: true, limits: FAST, review: reviewCfg } });
  }
  async function demoAccount(claims: Record<string, unknown> | null = { demoReview: true }) {
    const u = await getAuth().createUser({ displayName: 'Demo' });
    if (claims) await getAuth().setCustomUserClaims(u.uid, claims);
    await db().collection('users').doc(u.uid).set({ displayName: 'Demo', status: 'active', demo: true, createdAt: new Date(0) });
    return u.uid;
  }
  async function acceptedReview(uid: string) {
    await enableReview(uid);
    const s = await start();
    const r = await send(s, REVIEW);
    const first = await verify(s, r.challengeId, CODE);
    expect(first.uid).toBe(uid);
    return { s, r };
  }

  it('no review access unless configured: the old fixed number/code is just a normal number', async () => {
    const s = await start();
    const r = await send(s, '+970599999999');
    await expectHttps(verify(s, r.challengeId, '123456'), 'permission-denied', 'code-invalid');
  });

  it('signs into the designated demo only, sends no SMS, creates nothing, records NO phone', async () => {
    const demo = await demoAccount();
    await enableReview(demo);
    const before = await authUserCount();
    const s = await start();
    const r = await send(s, REVIEW);
    expect(await authJobs()).toBe(0);
    await expectHttps(verify(s, r.challengeId, '135791'), 'permission-denied', 'code-invalid');
    const res = await verify(s, r.challengeId, CODE);
    expect(res).toMatchObject({ uid: demo, isNewUser: false });
    expect(await authUserCount()).toBe(before);
    // No unproved phone ownership is recorded anywhere (so no contact/group linking).
    expect((await getAuth().getUser(demo)).phoneNumber).toBeUndefined();
    expect((await db().collection('users').doc(demo).get()).get('phoneVerified')).toBeUndefined();
    expect((await db().collection('users').doc(demo).collection('userPrivate').doc('profile').get()).exists).toBe(false);
  });

  it('a non-designated or privileged target is refused at runtime (no token)', async () => {
    for (const claims of [null, { demoReview: true, admin: true }, { admin: true }, { demoReview: true, role: 'super_admin' }]) {
      await resetEmulators(); await seedRelayDevice();
      const uid = await demoAccount(claims);
      await enableReview(uid);
      const s = await start();
      const r = await send(s, REVIEW);
      await expectHttps(verify(s, r.challengeId, CODE), 'permission-denied', 'account-disabled');
    }
  });

  it('N1: replaying the SAME accepted review op after disable / expiry / rotation / uid swap mints nothing', async () => {
    const demo = await demoAccount();
    const other = await demoAccount();
    const cases: Array<[string, () => Promise<void>]> = [
      ['disabled', () => enableReview(demo, { enabled: false })],
      ['expired', () => enableReview(demo, { expiresAtMs: Date.now() - 1 })],
      ['code rotated', () => enableReview(demo, { code: '999000' })],
      ['salt rotated (same code)', () => enableReview(demo)],
      ['demo uid replaced', () => enableReview(other, {}, true)],
    ];
    for (const [label, revoke] of cases) {
      const { s, r } = await acceptedReview(demo);
      expect((await verify(s, r.challengeId, '000000')).uid, `${label}: lost-response retry before revocation`).toBe(demo);
      await revoke();
      await expectHttps(verify(s, r.challengeId, CODE), 'not-found', 'challenge-not-found');
      // Next case: clear abuse counters (5 review logins on one number would
      // otherwise — correctly — hit the destination's hourly cap).
      await db().collection('smsRateLimits').get().then(q => Promise.all(q.docs.map(d => d.ref.delete())));
      await advance(61_000);
    }
  });

  it('N1: demo designation removed after acceptance → replay refused', async () => {
    const demo = await demoAccount();
    const { s, r } = await acceptedReview(demo);
    await getAuth().setCustomUserClaims(demo, { demoReview: true, admin: true });
    await expectHttps(verify(s, r.challengeId, CODE), 'permission-denied', 'account-disabled');
  });

  it('an over-long review window is ignored; a missing demo account is never created', async () => {
    await enableReview('no-such-demo-uid');
    const s = await start();
    const r = await send(s, REVIEW);
    const before = await authUserCount();
    await expectHttps(verify(s, r.challengeId, CODE), 'unavailable', 'signin-interrupted');
    expect(await authUserCount()).toBe(before);
    const demo = await demoAccount();
    await enableReview(demo, { expiresAtMs: Date.now() + 40 * 86_400_000 });
    const s2 = await start({ ip: '203.0.113.91' });
    await advance(61_000);
    const r2 = await send(s2, REVIEW);
    expect(await authJobs()).toBe(1); // treated as a normal number → real (mocked) SMS
    await expectHttps(verify(s2, r2.challengeId, CODE), 'permission-denied', 'code-invalid');
  });

  it('setup script: refuses a non-designated uid; --create-demo makes a clean designated account', async () => {
    const { spawnSync } = await import('node:child_process');
    const run = (args: string[]) => spawnSync('npx', ['tsx', 'scripts/setReviewAccess.ts', '--project=demo-offlinesms', ...args], {
      cwd: process.cwd().endsWith('functions') ? '..' : process.cwd(), encoding: 'utf8',
      env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: '' },
    });
    const plain = await getAuth().createUser({});
    const admin = await getAuth().createUser({});
    await getAuth().setCustomUserClaims(admin.uid, { demoReview: true, admin: true });
    expect(run([`--phone=${REVIEW}`, `--uid=${plain.uid}`]).status).toBe(2);
    expect(run([`--phone=${REVIEW}`, `--uid=${admin.uid}`]).status).toBe(2);
    const ok = run([`--phone=${REVIEW}`, '--create-demo', '--days=3']);
    expect(ok.status).toBe(0);
    const review = (await db().collection('smsConfig').doc('otp').get()).get('signin.review');
    const demo = await getAuth().getUser(review.uid);
    expect(demo.customClaims).toEqual({ demoReview: true });
    expect(demo.phoneNumber).toBeUndefined();
    expect(review.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(review)).not.toMatch(/"code"/);
  }, 120_000);
});

describe('N1 — every token mint re-checks eligibility inside a bounded window', () => {
  it('suspension via profile status (as setUserStatus does) after completion → no new token', async () => {
    const s = await start();
    const r = await send(s, num(160));
    const res = await verify(s, r.challengeId, await code(r.challengeId));
    expect((await verify(s, r.challengeId, '000000')).uid).toBe(res.uid); // immediate retry still fine
    await db().collection('users').doc(res.uid).update({ status: 'suspended' });
    await expectHttps(verify(s, r.challengeId, '000000'), 'permission-denied', 'account-disabled');
  });

  it('Auth-disabled after completion → no new token', async () => {
    const s = await start();
    const r = await send(s, num(161));
    const res = await verify(s, r.challengeId, await code(r.challengeId));
    await getAuth().updateUser(res.uid, { disabled: true });
    await expectHttps(verify(s, r.challengeId, '000000'), 'permission-denied', 'account-disabled');
  });

  it('an op interrupted before bootstrap cannot be completed after the window (measured from acceptance)', async () => {
    const s = await start();
    const r = await send(s, num(162));
    const c = await code(r.challengeId);
    phoneAuthDeps.beforeBootstrap = async () => { throw new Error('crash'); };
    await expectHttps(verify(s, r.challengeId, c), 'unavailable', 'signin-interrupted');
    phoneAuthDeps.beforeBootstrap = deps.beforeBootstrap;
    await advance(601_000); // tokenRetryWindowSec default 600 s
    const users = await authUserCount();
    await expectHttps(verify(s, r.challengeId, c), 'not-found', 'challenge-not-found');
    const op = (await db().collection('phoneAuthOps').doc(r.challengeId).get()).data()!;
    expect(op.stage).not.toBe('done');
    expect(await authUserCount()).toBe(users);
  });

  it('a done op is not re-issued after the window either', async () => {
    const s = await start();
    const r = await send(s, num(163));
    await verify(s, r.challengeId, await code(r.challengeId));
    await advance(601_000);
    await expectHttps(verify(s, r.challengeId, '000000'), 'not-found', 'challenge-not-found');
  });
});

// ── M ─────────────────────────────────────────────────────────────────────
describe('M — off by default, fails closed', () => {
  it('deploy env gate unset → unavailable even with the policy on', async () => {
    process.env.PHONE_AUTH_ENABLED = '';
    await expectHttps(start(), 'failed-precondition', 'phone-auth-unavailable');
  });

  it("today's production policy shape (businessId only) → unavailable", async () => {
    await db().collection('smsConfig').doc('otp').set({ businessId: 'biz-verify' });
    await expectHttps(start(), 'failed-precondition', 'phone-auth-unavailable');
    await db().collection('smsConfig').doc('otp').delete();
    await expectHttps(start(), 'failed-precondition', 'phone-auth-unavailable');
  });

  it('emergency stop blocks new codes; a code already sent can still be verified', async () => {
    const s = await start();
    const r = await send(s, num(150));
    await seedPolicy({ emergencyStop: true, signin: { enabled: true, limits: FAST } });
    await expectHttps(start(), 'unavailable', 'service-paused');
    await advance(61_000);
    await expectHttps(send(s, num(151)), 'unavailable', 'service-paused');
    expect((await verify(s, r.challengeId, await code(r.challengeId))).isNewUser).toBe(true);
  });

  it('signin purpose off → verify refused too (suspension)', async () => {
    const s = await start();
    const r = await send(s, num(152));
    await seedPolicy({ signin: { enabled: false } });
    await expectHttps(verify(s, r.challengeId, await code(r.challengeId)), 'failed-precondition', 'phone-auth-unavailable');
  });
});
