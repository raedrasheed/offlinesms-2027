// Sign-in methods on ONE account: an account that started with email adds a
// phone, an account that started with phone adds an email, and either replaces
// its email or phone — always keeping the same uid, conversations, wallet and
// roles, never creating or merging accounts. Real handlers on the Firestore +
// Auth emulators; SMS codes are read from the queued relay job and email codes
// from a mocked provider, so nothing is ever sent.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from 'firebase-admin/auth';
import { randomBytes } from 'node:crypto';
import type { HttpsError } from 'firebase-functions/v2/https';

const sent: Array<{ to: string; text: string; subject: string }> = [];
let failSend = false;
vi.mock('../src/lib/email', () => ({
  sendEmail: vi.fn(async (m: { to: string; text: string; subject: string }) => {
    if (failSend) throw new Error('provider down');
    sent.push(m);
  }),
}));

import {
  db, resetEmulators, seedPolicy, seedRelayDevice, makeEmailUser, req, expectHttps,
  deliveredCode, authUserCount, num, linkReq, PROJECT,
} from './harness';
import { handleStartPhoneAuth } from '../src/phoneAuth/startPhoneAuth';
import { handleRequestPhoneAuthCode } from '../src/phoneAuth/requestPhoneAuthCode';
import { handleVerifyPhoneAuthCode } from '../src/phoneAuth/verifyPhoneAuthCode';
import { solvePow } from '../src/phoneAuth/pow';
import { handleRequestPhoneLinkOtp } from '../src/phoneLink/requestPhoneLinkOtp';
import { handleVerifyPhoneLinkOtp } from '../src/phoneLink/verifyPhoneLinkOtp';
import { handleGetPhoneLinkStatus } from '../src/phoneLink/getPhoneLinkStatus';
import { phoneHmac } from '../src/phoneLink/crypto';
import { requestEmailOtp } from '../src/auth/requestEmailOtp';
import { verifyEmailOtp } from '../src/auth/verifyEmailOtp';
import { handleRequestEmailChangeCode } from '../src/emailChange/requestEmailChangeCode';
import {
  handleVerifyEmailChangeCode, handleResumeEmailChange, emailChangeDeps,
} from '../src/emailChange/verifyEmailChangeCode';
import { handleGetSignInMethods } from '../src/emailChange/getSignInMethods';
import { userPrivateProfileRef } from '../src/lib/userPrivate';
import { runReconcilePass } from '../src/emailChange/authWrites';
import { handleBeforeSignIn, handleBeforeEmailSent } from '../src/emailChange/signInGuard';

const FAST = { powBits: 8, powMaxBits: 8 };
const PEPPER = process.env.PHONE_HASH_PEPPER!;
const rid = () => randomBytes(12).toString('base64url');
const lastCodeTo = (to: string) => {
  const m = [...sent].reverse().find(x => x.to === to);
  return /\b(\d{6})\b/.exec(m?.text ?? '')?.[1] ?? '';
};
const wrong = (c: string) => (c === '000000' ? '111111' : '000000');

async function advance(ms: number) {
  vi.setSystemTime(Date.now() + ms);
  await seedRelayDevice();
}

/** Full public phone sign-in for `phone`; returns the account it lands in. */
async function phoneSignIn(phone: string, ip = '198.51.100.7'): Promise<{ uid: string; isNewUser: boolean }> {
  const sess = await handleStartPhoneAuth(req(null, { installationId: 'inst-' + rid() }, { ip })) as {
    sessionToken: string; pow: { nonce: string; bits: number };
  };
  const r = await handleRequestPhoneAuthCode(req(null, {
    sessionToken: sess.sessionToken, phoneE164: phone, powNonce: sess.pow.nonce,
    powSolution: solvePow(sess.pow.nonce, phone, sess.pow.bits)!, requestId: rid(),
  }, { ip })) as { challengeId: string };
  const code = await deliveredCode(r.challengeId, 'pauth');
  return handleVerifyPhoneAuthCode(req(null, { sessionToken: sess.sessionToken, challengeId: r.challengeId, code }, { ip })) as Promise<{ uid: string; isNewUser: boolean }>;
}

/** Full email-code sign-in; returns the account it lands in. */
async function emailSignIn(email: string): Promise<{ uid: string }> {
  await requestEmailOtp.run(req(null, { email }));
  return verifyEmailOtp.run(req(null, { email, code: lastCodeTo(email) })) as Promise<{ uid: string }>;
}

async function linkPhone(uid: string, phone: string) {
  const r = await handleRequestPhoneLinkOtp(req(uid, linkReq(phone))) as { challengeId: string };
  return handleVerifyPhoneLinkOtp(req(uid, { challengeId: r.challengeId, code: await deliveredCode(r.challengeId) }));
}

const requestEmail = (uid: string, email: string, o: Parameters<typeof req>[2] = {}) =>
  handleRequestEmailChangeCode(req(uid, { email }, o)) as Promise<{ challengeId: string; maskedEmail: string }>;
const verifyEmail = (uid: string, challengeId: string, code: string, o: Parameters<typeof req>[2] = {}) =>
  handleVerifyEmailChangeCode(req(uid, { challengeId, code }, o)) as Promise<{ changed: true; email: string }>;

async function changeEmail(uid: string, email: string) {
  const r = await requestEmail(uid, email);
  return verifyEmail(uid, r.challengeId, lastCodeTo(email));
}

/** Account state that must survive any sign-in-method change. */
async function accountState(uid: string) {
  const [user, wallet, member, conv] = await Promise.all([
    db().collection('users').doc(uid).get(),
    db().collection('wallets').doc(uid).get(),
    db().collection('conversations').doc(`grp-${uid}`).collection('members').doc(uid).get(),
    db().collection('conversations').doc(`grp-${uid}`).get(),
  ]);
  return {
    displayName: user.get('displayName') ?? null, username: user.get('username') ?? null,
    balance: wallet.get('balance') ?? null, role: member.get('role') ?? null,
    participants: conv.get('participantUids') ?? null,
  };
}

/** Give a phone-created account the same profile/wallet/group fixtures. */
async function decorate(uid: string) {
  await db().collection('users').doc(uid).set({ displayName: 'Sara', username: 'sara', profileCompleted: true }, { merge: true });
  await db().collection('wallets').doc(uid).set({ balance: 120, reserved: 0 });
  await db().collection('conversations').doc(`grp-${uid}`).set({ type: 'group', participantUids: [uid, 'peer-1'], name: 'G' });
  await db().collection('conversations').doc(`grp-${uid}`).collection('members').doc(uid).set({ role: 'admin', status: 'active' });
}

const origSetAuthEmail = emailChangeDeps.setAuthEmail;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  await resetEmulators();
  sent.length = 0;
  failSend = false;
  await seedPolicy({ signin: { enabled: true, limits: FAST }, link: { enabled: true } });
  await seedRelayDevice();
  await db().collection('systemSettings').doc('general').set({ emailSignInEnabled: true });
});
const origBeforeAuthWrite = emailChangeDeps.beforeAuthWrite;
const origBeforeFinalize = emailChangeDeps.beforeFinalize;
const origAfterAuthCheck = emailChangeDeps.afterAuthCheck;
afterEach(() => {
  emailChangeDeps.afterAuthCheck = origAfterAuthCheck;
  vi.useRealTimers();
  emailChangeDeps.setAuthEmail = origSetAuthEmail;
  emailChangeDeps.beforeAuthWrite = origBeforeAuthWrite;
  emailChangeDeps.beforeFinalize = origBeforeFinalize;
});

describe('path A — started with email, then added a phone', () => {
  it('both methods sign in to the same account, which keeps its data', async () => {
    const u = await makeEmailUser();
    const before = await accountState(u.uid);
    await linkPhone(u.uid, num(1));
    await advance(61_000); // per-number SMS cooldown is shared by link and sign-in codes
    expect((await phoneSignIn(num(1))).uid).toBe(u.uid);
    expect((await emailSignIn(u.email)).uid).toBe(u.uid);
    expect(await accountState(u.uid)).toEqual(before);
    expect(await authUserCount()).toBe(1);
  });

  it('replacing the phone: the old number stays valid until the new one verifies, then stops signing in here', async () => {
    const u = await makeEmailUser();
    await linkPhone(u.uid, num(1));
    await advance(61_000);
    const r = await handleRequestPhoneLinkOtp(req(u.uid, linkReq(num(2)))) as { challengeId: string };
    // Not yet verified: the old number still signs in to this account.
    expect((await getAuth().getUser(u.uid)).phoneNumber).toBe(num(1));
    expect((await phoneSignIn(num(1))).uid).toBe(u.uid);
    await handleVerifyPhoneLinkOtp(req(u.uid, { challengeId: r.challengeId, code: await deliveredCode(r.challengeId) }));
    expect((await getAuth().getUser(u.uid)).phoneNumber).toBe(num(2));
    await advance(61_000);
    expect((await phoneSignIn(num(2), '198.51.100.8')).uid).toBe(u.uid);
    // The old number no longer reaches this account (it would be a brand-new sign-up).
    const old = await phoneSignIn(num(1), '198.51.100.9');
    expect(old.uid).not.toBe(u.uid);
    expect(old.isNewUser).toBe(true);
    // Its claim was released; the new claim belongs to the account.
    expect((await db().collection('phoneClaims').doc(phoneHmac(PEPPER, num(1))).get()).exists).toBe(false);
    expect((await db().collection('phoneClaims').doc(phoneHmac(PEPPER, num(2))).get()).get('uid')).toBe(u.uid);
    const priv = await db().collection('users').doc(u.uid).collection('userPrivate').doc('profile').get();
    expect(priv.get('phoneNumber')).toBe(num(2));
  });

  it('asking for the number the account already has is refused as already linked', async () => {
    const u = await makeEmailUser();
    await linkPhone(u.uid, num(1));
    await advance(61_000);
    await expectHttps(handleRequestPhoneLinkOtp(req(u.uid, linkReq(num(1)))), 'failed-precondition', 'already-linked');
  });

  it('replacing the email: code goes to the NEW address; the old address stops signing in here', async () => {
    const u = await makeEmailUser();
    const before = await accountState(u.uid);
    const next = 'new-address@example.test';
    const r = await requestEmail(u.uid, next);
    expect(sent.map(m => m.to)).toEqual([next]);
    expect(sent[0].subject).toMatch(/Confirm your email/);
    // Until verified, the current address is unchanged.
    expect((await getAuth().getUser(u.uid)).email).toBe(u.email);
    const done = await verifyEmail(u.uid, r.challengeId, lastCodeTo(next)) as { customToken?: string };
    // Firebase ends existing sessions on an email change; this device gets a token for the same account.
    expect(typeof done.customToken).toBe('string');
    const auth = await getAuth().getUser(u.uid);
    expect(auth.email).toBe(next);
    expect(auth.emailVerified).toBe(true);
    await advance(61_000);
    expect((await emailSignIn(next)).uid).toBe(u.uid);
    await advance(61_000);
    const old = await emailSignIn(u.email);
    expect(old.uid).not.toBe(u.uid);
    expect(await accountState(u.uid)).toEqual(before);
    const priv = await db().collection('users').doc(u.uid).collection('userPrivate').doc('profile').get();
    expect(priv.get('email')).toBe(next);
  });
});

describe('path B — started with phone, then added an email', () => {
  it('adds an email, signs in both ways to one account, then replaces the phone', async () => {
    const first = await phoneSignIn(num(5));
    expect(first.isNewUser).toBe(true);
    const uid = first.uid;
    await decorate(uid);
    const before = await accountState(uid);

    // Settings shows both methods: phone present, email missing.
    const m0 = await handleGetSignInMethods(req(uid, {}));
    expect(m0).toMatchObject({ email: null, phone: num(5), emailChange: { available: true, pendingRecovery: false } });

    await changeEmail(uid, 'sara@example.test');
    await advance(61_000);
    expect((await emailSignIn('sara@example.test')).uid).toBe(uid);
    expect((await phoneSignIn(num(5), '198.51.100.20')).uid).toBe(uid);
    const m1 = await handleGetSignInMethods(req(uid, {}));
    expect(m1).toMatchObject({ email: 'sara@example.test', emailVerified: true, phone: num(5) });

    // A phone-registered account is eligible to change its phone.
    const st = await handleGetPhoneLinkStatus(req(uid, {}));
    expect(st).toMatchObject({ available: true, eligible: true, linked: true });
    await advance(61_000);
    await linkPhone(uid, num(6));
    await advance(61_000);
    expect((await phoneSignIn(num(6), '198.51.100.21')).uid).toBe(uid);
    expect((await phoneSignIn(num(5), '198.51.100.22')).uid).not.toBe(uid);

    // And can change the email it added.
    await advance(61_000);
    await changeEmail(uid, 'sara2@example.test');
    await advance(61_000);
    expect((await emailSignIn('sara2@example.test')).uid).toBe(uid);

    expect(await accountState(uid)).toEqual(before);
  });
});

describe('email codes: wrong, expired, used, wrong account, wrong purpose', () => {
  it('a wrong code is refused with attempts left; the challenge burns after 5', async () => {
    const u = await makeEmailUser();
    const r = await requestEmail(u.uid, 'x@example.test');
    const good = lastCodeTo('x@example.test');
    const e = await expectHttps(verifyEmail(u.uid, r.challengeId, wrong(good)), 'permission-denied', 'code-invalid');
    expect((e.details as { attemptsLeft: number }).attemptsLeft).toBe(4);
    for (let i = 0; i < 3; i++) await expectHttps(verifyEmail(u.uid, r.challengeId, wrong(good)), 'permission-denied', 'code-invalid');
    await expectHttps(verifyEmail(u.uid, r.challengeId, wrong(good)), 'resource-exhausted', 'too-many-attempts');
    await expectHttps(verifyEmail(u.uid, r.challengeId, good), 'resource-exhausted', 'too-many-attempts');
    expect((await getAuth().getUser(u.uid)).email).toBe(u.email);
  });

  it('an expired code is refused and cannot be revived', async () => {
    const u = await makeEmailUser();
    const r = await requestEmail(u.uid, 'x@example.test');
    const good = lastCodeTo('x@example.test');
    vi.setSystemTime(Date.now() + 11 * 60_000);
    // Re-authenticated recently, but the code itself has expired.
    await expectHttps(verifyEmail(u.uid, r.challengeId, good, { authAgeSec: 5 }), 'deadline-exceeded', 'code-expired');
    await expectHttps(verifyEmail(u.uid, r.challengeId, good, { authAgeSec: 5 }), 'deadline-exceeded', 'code-expired');
    expect((await getAuth().getUser(u.uid)).email).toBe(u.email);
  });

  it('a used code cannot be replayed to change anything new', async () => {
    const u = await makeEmailUser();
    const r = await requestEmail(u.uid, 'x@example.test');
    const good = lastCodeTo('x@example.test');
    await verifyEmail(u.uid, r.challengeId, good);
    // Same challenge again (from a session signed in after the change, since
    // the change revoked the old one): idempotent, same result, nothing new.
    expect(await verifyEmail(u.uid, r.challengeId, good, { authAgeSec: -2 })).toMatchObject({ changed: true, email: 'x@example.test' });
    // A fresh challenge for another address cannot be satisfied by the old code.
    await advance(151_000);
    const r2 = await requestEmail(u.uid, 'y@example.test');
    const e = await verifyEmail(u.uid, r2.challengeId, good).catch(x => x as HttpsError);
    if (lastCodeTo('y@example.test') !== good) expect((e as HttpsError).message).toBe('code-invalid');
    expect((await getAuth().getUser(u.uid)).email).toBe('x@example.test');
  });

  it("another account cannot verify someone's challenge, even with the right code", async () => {
    const a = await makeEmailUser();
    const b = await makeEmailUser();
    const r = await requestEmail(a.uid, 'x@example.test');
    await expectHttps(verifyEmail(b.uid, r.challengeId, lastCodeTo('x@example.test')), 'not-found', 'challenge-not-found');
    expect((await getAuth().getUser(b.uid)).email).toBe(b.email);
    await verifyEmail(a.uid, r.challengeId, lastCodeTo('x@example.test'));
  });

  it('a newer code invalidates the older one', async () => {
    const u = await makeEmailUser();
    const r1 = await requestEmail(u.uid, 'x@example.test');
    const c1 = lastCodeTo('x@example.test');
    await advance(61_000);
    const r2 = await requestEmail(u.uid, 'x@example.test');
    await expectHttps(verifyEmail(u.uid, r1.challengeId, c1), 'not-found', 'challenge-not-found');
    await verifyEmail(u.uid, r2.challengeId, lastCodeTo('x@example.test'));
  });

  it('a sign-in code for the address cannot confirm a change', async () => {
    const u = await makeEmailUser();
    const r = await requestEmail(u.uid, 'x@example.test');
    await advance(61_000);
    await requestEmailOtp.run(req(null, { email: 'x@example.test' }));
    const signinCode = lastCodeTo('x@example.test');
    const err = await verifyEmail(u.uid, r.challengeId, signinCode).catch(x => x as HttpsError);
    expect(['code-invalid', 'code-expired', 'too-many-attempts']).toContain((err as HttpsError).message);
    expect((await getAuth().getUser(u.uid)).email).toBe(u.email);
  });
});

describe('conflicts with another account — never merged', () => {
  it('an address held by another account is refused after proof; nothing changes on either account', async () => {
    const a = await makeEmailUser();
    const b = await makeEmailUser();
    const before = await accountState(a.uid);
    const users = await authUserCount();
    const r = await requestEmail(a.uid, b.email);
    await expectHttps(verifyEmail(a.uid, r.challengeId, lastCodeTo(b.email)), 'already-exists', 'email-unavailable');
    expect((await getAuth().getUser(a.uid)).email).toBe(a.email);
    expect((await getAuth().getUser(b.uid)).email).toBe(b.email);
    expect(await accountState(a.uid)).toEqual(before);
    expect(await authUserCount()).toBe(users);
    // The account can still start a different change afterwards.
    await advance(61_000);
    await changeEmail(a.uid, 'free@example.test');
  });

  it('a phone held by another account is refused without an SMS', async () => {
    const a = await makeEmailUser();
    const b = await makeEmailUser();
    await linkPhone(b.uid, num(3));
    await expectHttps(handleRequestPhoneLinkOtp(req(a.uid, linkReq(num(3)))), 'already-exists', 'phone-unavailable');
    expect((await getAuth().getUser(b.uid)).phoneNumber).toBe(num(3));
    expect((await getAuth().getUser(a.uid)).phoneNumber).toBeUndefined();
  });

  it('two accounts verifying one address at once: exactly one wins', async () => {
    const a = await makeEmailUser();
    const b = await makeEmailUser();
    const ra = await requestEmail(a.uid, 'shared@example.test');
    const ca = lastCodeTo('shared@example.test');
    // Destination cooldown is shared with sign-in; move past it.
    await advance(61_000);
    const rb = await requestEmail(b.uid, 'shared@example.test');
    const cb = lastCodeTo('shared@example.test');
    const rs = await Promise.allSettled([verifyEmail(a.uid, ra.challengeId, ca), verifyEmail(b.uid, rb.challengeId, cb)]);
    expect(rs.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rej = rs.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect((rej.reason as HttpsError).message).toBe('email-unavailable');
    const holders = [(await getAuth().getUser(a.uid)).email, (await getAuth().getUser(b.uid)).email].filter(e => e === 'shared@example.test');
    expect(holders).toHaveLength(1);
  });
});

describe('re-authentication, availability, limits, concurrency, interruption', () => {
  it('a stale sign-in must re-authenticate before a change starts', async () => {
    const u = await makeEmailUser();
    await expectHttps(requestEmail(u.uid, 'x@example.test', { authAgeSec: 3600 }), 'unauthenticated', 'reauth-required');
    await expectHttps(handleRequestPhoneLinkOtp(req(u.uid, linkReq(num(1)), { authAgeSec: 3600 })), 'unauthenticated', 'reauth-required');
    expect(sent).toHaveLength(0);
  });

  it('switched off: refused, nothing sent', async () => {
    await db().collection('systemSettings').doc('general').set({ emailSignInEnabled: false });
    const u = await makeEmailUser();
    await expectHttps(requestEmail(u.uid, 'x@example.test'), 'failed-precondition', 'email-change-disabled');
    expect(sent).toHaveLength(0);
  });

  it('the address the account already has (verified) is refused as already linked', async () => {
    const u = await makeEmailUser();
    await expectHttps(requestEmail(u.uid, u.email.toUpperCase()), 'failed-precondition', 'already-linked');
  });

  it('parallel requests from one account send exactly one email', async () => {
    const u = await makeEmailUser();
    const rs = await Promise.allSettled(Array.from({ length: 8 }, () => requestEmail(u.uid, 'x@example.test')));
    expect(rs.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it('parallel correct verifications change once, consistently', async () => {
    const u = await makeEmailUser();
    const r = await requestEmail(u.uid, 'x@example.test');
    const c = lastCodeTo('x@example.test');
    const rs = await Promise.allSettled(Array.from({ length: 5 }, () => verifyEmail(u.uid, r.challengeId, c)));
    expect(rs.some(x => x.status === 'fulfilled')).toBe(true);
    expect((await getAuth().getUser(u.uid)).email).toBe('x@example.test');
    expect((await db().collection('emailChangeOps').doc(u.uid).get()).get('stage')).toBe('done');
  });

  it('a provider failure voids the code and changes nothing', async () => {
    const u = await makeEmailUser();
    failSend = true;
    await expectHttps(requestEmail(u.uid, 'x@example.test'), 'unavailable', 'email-send-failed');
    const ch = await db().collection('emailChangeChallenges').doc(u.uid).get();
    expect(ch.get('status')).toBe('send-failed');
    expect(ch.get('codeHash')).toBeUndefined();
  });

  it('Auth update interrupted → change-interrupted; resume finishes without a new code or email', async () => {
    const u = await makeEmailUser();
    const r = await requestEmail(u.uid, 'x@example.test');
    emailChangeDeps.setAuthEmail = async () => { throw Object.assign(new Error('net'), { code: 'auth/internal-error' }); };
    await expectHttps(verifyEmail(u.uid, r.challengeId, lastCodeTo('x@example.test')), 'unavailable', 'change-interrupted');
    expect((await getAuth().getUser(u.uid)).email).toBe(u.email);
    // A new change can't start while this one is pending.
    await advance(61_000);
    await expectHttps(requestEmail(u.uid, 'y@example.test'), 'failed-precondition', 'change-pending-recovery');
    expect((await handleGetSignInMethods(req(u.uid, {}))).emailChange.pendingRecovery).toBe(true);
    emailChangeDeps.setAuthEmail = origSetAuthEmail;
    const sentBefore = sent.length;
    await expectHttps(handleResumeEmailChange(req(u.uid, {})), 'not-found', 'challenge-not-found');
    await handleResumeEmailChange(req(u.uid, { challengeId: r.challengeId }));
    expect((await getAuth().getUser(u.uid)).email).toBe('x@example.test');
    expect(sent.length).toBe(sentBefore);
  });

  it('audit rows and challenge docs never contain the address or the code', async () => {
    const u = await makeEmailUser();
    const r = await requestEmail(u.uid, 'secret-addr@example.test');
    const code = lastCodeTo('secret-addr@example.test');
    await verifyEmail(u.uid, r.challengeId, code);
    const audit = JSON.stringify((await db().collection('auditLogs').get()).docs.map(d => d.data()));
    expect(audit).not.toContain('secret-addr');
    expect(audit).not.toContain(code);
    const op = JSON.stringify((await db().collection('emailChangeOps').doc(u.uid).get()).data());
    expect(op).not.toContain('secret-addr');
  });
});

// ── Review findings: revoked sessions and stale writers ─────────────────────

const resume = (uid: string, data: Record<string, unknown>, o: Parameters<typeof req>[2] = {}) =>
  handleResumeEmailChange(req(uid, data, o)) as Promise<{ changed: true; email: string; customToken: string }>;

function gate() {
  let open!: () => void;
  const p = new Promise<void>(r => { open = r; });
  return { p, open };
}

/** Set the account's "sessions valid since" (what revokeRefreshTokens does), at a chosen second. */
async function setValidSince(uid: string, sec: number) {
  const au = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const r = await fetch(`http://${au}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: uid, validSince: String(sec) }),
  });
  if (!r.ok) throw new Error(`validSince update failed: ${r.status} ${await r.text()}`);
}

const markerSec = async (uid: string) => Math.floor(Date.parse((await getAuth().getUser(uid)).tokensValidAfterTime!) / 1000);
/** A sign-in made after every revocation so far (what signing in again gives the device). */
const freshAfter = async (uid: string) => ({ claims: { auth_time: (await markerSec(uid)) + 1 } });
const mintedTokens = () => vi.spyOn(getAuth(), 'createCustomToken');
const OLD_KEY = 'ab'.repeat(32);

/** Change the email on one session whose reply is then "lost"; returns that session. */
async function changeAndLoseReply(email = 'x@example.test') {
  const u = await makeEmailUser();
  const session = { claims: { auth_time: Math.floor(Date.now() / 1000) - 5 } };
  const r = await requestEmail(u.uid, email, session);
  await handleVerifyEmailChangeCode(req(u.uid, { challengeId: r.challengeId, code: lastCodeTo(email), recoveryKey: OLD_KEY }, session));
  const user = await getAuth().getUser(u.uid);
  expect(user.email).toBe(email);
  // The change itself revoked this session.
  expect(Date.parse(user.tokensValidAfterTime!) / 1000).toBeGreaterThan(session.claims.auth_time);
  return { u, r, session };
}

describe('R4-1: a revoked session never continues a change; signing in again to the same account does', () => {
  const origAfterAuthWrite = emailChangeDeps.afterAuthWrite;
  afterEach(() => { emailChangeDeps.afterAuthWrite = origAfterAuthWrite; vi.restoreAllMocks(); });

  /**
   * Revocation schedules around the change's own Auth write. Each one ends with
   * the original request interrupted before it finalized (no token), then the
   * same device tries to resume with its old, revoked session.
   *   own        — only the change's own revocation (the legitimate case)
   *   in-flight  — Codex R4 case 2: an independent revocation one second later,
   *                while the write call still awaits its response
   *   after +Ns  — Codex R4 case 1 (+1s after a short write) and R3-1 (+2/+10/+24s):
   *                an independent revocation after the write returned
   */
  const schedules: Array<{ name: string; inFlight?: number; after?: number }> = [
    { name: 'own revocation only' },
    { name: 'independent revocation +1s while the write awaits its response', inFlight: 1 },
    ...[1, 2, 10, 24].map(d => ({ name: `independent revocation +${d}s after the write returned`, after: d })),
  ];
  for (const sch of schedules) {
    it(`${sch.name}: resume refused with reauth-required and no token; a fresh sign-in finishes`, async () => {
      const u = await makeEmailUser();
      const session = { claims: { auth_time: Math.floor(Date.now() / 1000) - 5 } };
      const r = await requestEmail(u.uid, 'x@example.test', session);
      let own = 0;
      emailChangeDeps.setAuthEmail = async (uid, email) => {
        emailChangeDeps.setAuthEmail = origSetAuthEmail;
        await origSetAuthEmail(uid, email);
        own = await markerSec(uid);
        if (sch.inFlight) await setValidSince(uid, own + sch.inFlight); // lands before the response does
      };
      emailChangeDeps.afterAuthWrite = async uid => {
        emailChangeDeps.afterAuthWrite = origAfterAuthWrite;
        if (sch.after) await setValidSince(uid, own + sch.after);
      };
      emailChangeDeps.beforeFinalize = async () => {
        emailChangeDeps.beforeFinalize = origBeforeFinalize;
        throw new Error('interrupted before finalize');
      };
      const tokens = mintedTokens();
      // Builds before this fix also sent a recovery key; it must buy nothing.
      await expectHttps(
        handleVerifyEmailChangeCode(req(u.uid, { challengeId: r.challengeId, code: lastCodeTo('x@example.test'), recoveryKey: OLD_KEY }, session)),
        'unavailable', 'change-interrupted');
      expect((await db().collection('emailChangeOps').doc(u.uid).get()).get('stage')).toBe('auth-updated');
      expect((await getAuth().getUser(u.uid)).email).toBe('x@example.test');
      const marker = await markerSec(u.uid);
      expect(marker).toBe(own + (sch.inFlight ?? sch.after ?? 0)); // distinct one-second markers where independent

      // The old session gets nothing, however it asks (with that recovery key included).
      await expectHttps(resume(u.uid, { challengeId: r.challengeId, recoveryKey: OLD_KEY }, session), 'unauthenticated', 'reauth-required');
      await expectHttps(resume(u.uid, { challengeId: r.challengeId }, session), 'unauthenticated', 'reauth-required');
      await expectHttps(verifyEmail(u.uid, r.challengeId, lastCodeTo('x@example.test'), session), 'unauthenticated', 'reauth-required');
      expect(tokens).not.toHaveBeenCalled();
      expect((await db().collection('emailChangeOps').doc(u.uid).get()).get('stage')).toBe('auth-updated');

      // Signed in again to the same account: the change finishes and the token is for that account.
      const out = await resume(u.uid, { challengeId: r.challengeId }, await freshAfter(u.uid));
      expect(out).toMatchObject({ changed: true, email: 'x@example.test' });
      expect(tokens).toHaveBeenCalledTimes(1);
      expect(tokens).toHaveBeenCalledWith(u.uid);
      expect((await db().collection('emailChangeOps').doc(u.uid).get()).get('stage')).toBe('done');
    });
  }

  it('after a completed change whose reply was lost, the old session is refused too (no token)', async () => {
    const { u, r, session } = await changeAndLoseReply();
    const tokens = mintedTokens();
    await expectHttps(resume(u.uid, {}, session), 'not-found', 'challenge-not-found');
    await expectHttps(resume(u.uid, { challengeId: r.challengeId, recoveryKey: OLD_KEY }, session), 'unauthenticated', 'reauth-required');
    await expectHttps(verifyEmail(u.uid, r.challengeId, '000000', session), 'unauthenticated', 'reauth-required');
    await setValidSince(u.uid, (await markerSec(u.uid)) + 60); // and after a later sign-out everywhere
    await expectHttps(resume(u.uid, { challengeId: r.challengeId }, session), 'unauthenticated', 'reauth-required');
    expect(tokens).not.toHaveBeenCalled();
    const out = await resume(u.uid, { challengeId: r.challengeId }, await freshAfter(u.uid));
    expect(out.email).toBe('x@example.test');
  });

  it('the device signs in again with the new, already verified address and resumes', async () => {
    const u = await makeEmailUser();
    const session = { claims: { auth_time: Math.floor(Date.now() / 1000) - 5 } };
    const r = await requestEmail(u.uid, 'x@example.test', session);
    emailChangeDeps.beforeFinalize = async () => {
      emailChangeDeps.beforeFinalize = origBeforeFinalize;
      throw new Error('interrupted before finalize');
    };
    await expectHttps(verifyEmail(u.uid, r.challengeId, lastCodeTo('x@example.test'), session), 'unavailable', 'change-interrupted');
    await expectHttps(resume(u.uid, { challengeId: r.challengeId }, session), 'unauthenticated', 'reauth-required');
    // Email-code sign-in to the address the Auth record carries now lands in the SAME account.
    await advance(61_000); // per-address email cooldown is shared with the change code
    const signedIn = await emailSignIn('x@example.test');
    expect(signedIn.uid).toBe(u.uid);
    const fresh = await freshAfter(u.uid);
    expect((await handleGetSignInMethods(req(u.uid, {}, fresh))).emailChange.pendingChallengeId).toBe(r.challengeId);
    expect((await resume(u.uid, { challengeId: r.challengeId }, fresh)).email).toBe('x@example.test');
    expect((await userPrivateProfileRef(db(), u.uid).get()).get('email')).toBe('x@example.test');
  });

  it("a fresh sign-in to ANOTHER account cannot finish this account's change", async () => {
    const { u, r } = await changeAndLoseReply();
    const other = await makeEmailUser();
    await expectHttps(resume(other.uid, { challengeId: r.challengeId }), 'not-found', 'challenge-not-found');
    expect((await db().collection('emailChangeOps').doc(u.uid).get()).get('challengeId')).toBe(r.challengeId);
  });

  it('a suspended or disabled account gets no token, even after signing in again', async () => {
    const { u, r } = await changeAndLoseReply();
    const tokens = mintedTokens();
    await db().collection('users').doc(u.uid).set({ status: 'suspended' }, { merge: true });
    await expectHttps(resume(u.uid, { challengeId: r.challengeId }, await freshAfter(u.uid)), 'permission-denied', 'account-disabled');
    await db().collection('users').doc(u.uid).set({ status: 'active' }, { merge: true });
    await getAuth().updateUser(u.uid, { disabled: true });
    await expectHttps(resume(u.uid, { challengeId: r.challengeId }, await freshAfter(u.uid)), 'permission-denied', 'account-disabled');
    expect(tokens).not.toHaveBeenCalled();
  });

  it('a suspension that lands while the change request is running stops its token', async () => {
    const u = await makeEmailUser();
    const r = await requestEmail(u.uid, 'x@example.test');
    emailChangeDeps.afterAuthWrite = async uid => {
      emailChangeDeps.afterAuthWrite = origAfterAuthWrite;
      await db().collection('users').doc(uid).set({ status: 'suspended' }, { merge: true });
    };
    const tokens = mintedTokens();
    await expectHttps(verifyEmail(u.uid, r.challengeId, lastCodeTo('x@example.test')), 'permission-denied', 'account-disabled');
    expect(tokens).not.toHaveBeenCalled();
  });

  it('a fresh session can still resume an interrupted change after a restart, by its challenge id', async () => {
    const u = await makeEmailUser();
    const r = await requestEmail(u.uid, 'x@example.test');
    emailChangeDeps.setAuthEmail = async () => { throw Object.assign(new Error('net'), { code: 'auth/internal-error' }); };
    await expectHttps(verifyEmail(u.uid, r.challengeId, lastCodeTo('x@example.test')), 'unavailable', 'change-interrupted');
    emailChangeDeps.setAuthEmail = origSetAuthEmail;
    const m = await handleGetSignInMethods(req(u.uid, {}));
    expect(m.emailChange.pendingChallengeId).toBe(r.challengeId);
    await resume(u.uid, { challengeId: m.emailChange.pendingChallengeId });
    expect((await getAuth().getUser(u.uid)).email).toBe('x@example.test');
  });
});

describe('stale Auth writers cannot bring back an earlier address (R2-2)', () => {
  const stage = async (uid: string) => (await db().collection('emailChangeOps').doc(uid).get()).get('stage');
  const privEmail = async (uid: string) => (await userPrivateProfileRef(db(), uid).get()).get('email');
  const authEmail = async (uid: string) => (await getAuth().getUser(uid)).email;
  const ledger = async (uid: string) => (await db().collection('emailChangeAuthWrites').doc(uid).get()).data() ?? {};

  /** Change A whose first worker stalls INSIDE its Auth write while a second worker completes A. */
  async function stalledA(o: { dead?: boolean } = {}) {
    const u = await makeEmailUser();
    const rA = await requestEmail(u.uid, 'a@example.test');
    const release = gate(); const reached = gate();
    let first = true;
    emailChangeDeps.setAuthEmail = async (uid, email) => {
      if (first && email === 'a@example.test') {
        first = false; reached.open(); await release.p;
        if (o.dead) await new Promise(() => { /* worker lost: never returns */ });
      }
      return origSetAuthEmail(uid, email);
    };
    const slow = verifyEmail(u.uid, rA.challengeId, lastCodeTo('a@example.test'));
    await reached.p;
    await resume(u.uid, { challengeId: rA.challengeId });
    expect(await stage(u.uid)).toBe('done');
    expect(await authEmail(u.uid)).toBe('a@example.test');
    return { u, slow, release };
  }
  /** A, then B accepted once A's stalled write is abandoned (its worker never reported). */
  async function bAfterAbandon(u: { uid: string }) {
    await advance(11 * 60_000);
    return requestEmail(u.uid, 'b@example.test');
  }

  it('a new change waits while an earlier Auth write is pending — not just for a while', async () => {
    const { u, slow, release } = await stalledA();
    await expectHttps(requestEmail(u.uid, 'b@example.test', { authAgeSec: -2 }), 'resource-exhausted', 'change-settling');
    await advance(151_000);
    await expectHttps(requestEmail(u.uid, 'b@example.test'), 'resource-exhausted', 'change-settling');
    expect(Object.keys((await ledger(u.uid)).pending ?? {})).toHaveLength(1);
    release.open();
    await slow; // same address as the settled one: completes harmlessly
    // Resolved by its own worker: nothing pending, and the next change may start.
    expect(Object.keys((await ledger(u.uid)).pending ?? {})).toHaveLength(0);
    await advance(61_000);
    await requestEmail(u.uid, 'b@example.test');
  });

  it("Codex R2-2 ordering: A lands between B's Auth read and B's finalize; B does not report success on a wrong Auth", async () => {
    const { u, slow, release } = await stalledA();
    const rB = await bAfterAbandon(u);
    expect(Object.keys((await ledger(u.uid)).uncertain ?? {})).toHaveLength(1);
    emailChangeDeps.afterAuthCheck = async () => {
      emailChangeDeps.afterAuthCheck = async () => {};
      release.open();
      await slow.catch(() => {});
      expect(await authEmail(u.uid)).toBe('a@example.test');
    };
    await expectHttps(verifyEmail(u.uid, rB.challengeId, lastCodeTo('b@example.test')), 'unavailable', 'change-interrupted');
    expect(await stage(u.uid)).toBe('verified');
    expect(await privEmail(u.uid)).toBe('a@example.test');
    await resume(u.uid, { challengeId: rB.challengeId }, { authAgeSec: -2 });
    expect(await authEmail(u.uid)).toBe('b@example.test');
    expect(await privEmail(u.uid)).toBe('b@example.test');
    expect(await stage(u.uid)).toBe('done');
  });

  it('same ordering with the stale worker lost (it never reports): B repairs Auth before reporting success', async () => {
    const { u } = await stalledA({ dead: true });
    const rB = await bAfterAbandon(u);
    emailChangeDeps.afterAuthCheck = async uid => {
      emailChangeDeps.afterAuthCheck = async () => {};
      await origSetAuthEmail(uid, 'a@example.test'); // the lost worker's request lands now
    };
    const out = await verifyEmail(u.uid, rB.challengeId, lastCodeTo('b@example.test'));
    expect(out.email).toBe('b@example.test');
    expect(await authEmail(u.uid)).toBe('b@example.test');
    expect(await privEmail(u.uid)).toBe('b@example.test');
    const audit = (await db().collection('auditLogs').get()).docs.map(d => d.get('action'));
    expect(audit).toContain('emailChange.authEmailRepaired');
  });

  it('a lost worker whose write lands after B completed is repaired by the scheduled pass', async () => {
    const { u } = await stalledA({ dead: true });
    const rB = await bAfterAbandon(u);
    await verifyEmail(u.uid, rB.challengeId, lastCodeTo('b@example.test'));
    await origSetAuthEmail(u.uid, 'a@example.test'); // lands late, nobody reports it
    expect(await authEmail(u.uid)).toBe('a@example.test');
    expect(await runReconcilePass(Date.now() + 16 * 60_000)).toBeGreaterThan(0);
    expect(await authEmail(u.uid)).toBe('b@example.test');
    expect(await privEmail(u.uid)).toBe('b@example.test');
    // The uncertain write stays on the books until it ages out with Auth consistent.
    expect(Object.keys((await ledger(u.uid)).uncertain ?? {})).toHaveLength(1);
    await runReconcilePass(Date.now() + 25 * 3600_000);
    expect(Object.keys((await ledger(u.uid)).uncertain ?? {})).toHaveLength(0);
  });

  it('a live stale worker reporting after B completed undoes its own write', async () => {
    const { u, slow, release } = await stalledA();
    const rB = await bAfterAbandon(u);
    await verifyEmail(u.uid, rB.challengeId, lastCodeTo('b@example.test'));
    release.open();
    await expectHttps(slow, 'not-found', 'challenge-not-found');
    expect(await authEmail(u.uid)).toBe('b@example.test');
    expect(await privEmail(u.uid)).toBe('b@example.test');
    await expect(getAuth().getUserByEmail('a@example.test')).rejects.toBeTruthy();
  });

  it('a late write that lands before B reads Auth is caught by the read', async () => {
    const { u, slow, release } = await stalledA();
    const rB = await bAfterAbandon(u);
    emailChangeDeps.beforeFinalize = async () => {
      emailChangeDeps.beforeFinalize = origBeforeFinalize;
      release.open();
      await slow.catch(() => {});
    };
    await expectHttps(verifyEmail(u.uid, rB.challengeId, lastCodeTo('b@example.test')), 'unavailable', 'change-interrupted');
    await resume(u.uid, { challengeId: rB.challengeId }, { authAgeSec: -2 });
    expect(await authEmail(u.uid)).toBe('b@example.test');
    expect(await stage(u.uid)).toBe('done');
  });

  it('a write whose outcome is unknown (timeout) is kept as uncertain, not dropped', async () => {
    const u = await makeEmailUser();
    const r = await requestEmail(u.uid, 'x@example.test');
    emailChangeDeps.setAuthEmail = async () => { throw Object.assign(new Error('timeout'), { code: 'app/network-timeout' }); };
    await expectHttps(verifyEmail(u.uid, r.challengeId, lastCodeTo('x@example.test')), 'unavailable', 'change-interrupted');
    const l = await ledger(u.uid);
    expect(Object.keys(l.pending ?? {})).toHaveLength(0);
    expect(Object.keys(l.uncertain ?? {})).toHaveLength(1);
    emailChangeDeps.setAuthEmail = origSetAuthEmail;
    await resume(u.uid, { challengeId: r.challengeId });
    expect(await authEmail(u.uid)).toBe('x@example.test');
  });

  it('a worker that stalls past its claim deadline does not write', async () => {
    const u = await makeEmailUser();
    const r = await requestEmail(u.uid, 'x@example.test');
    const release = gate(); const reached = gate();
    emailChangeDeps.beforeAuthWrite = async () => {
      emailChangeDeps.beforeAuthWrite = origBeforeAuthWrite;
      reached.open(); await release.p;
    };
    const writes: string[] = [];
    emailChangeDeps.setAuthEmail = async (uid, email) => { writes.push(email); return origSetAuthEmail(uid, email); };
    const slow = verifyEmail(u.uid, r.challengeId, lastCodeTo('x@example.test'));
    await reached.p;
    vi.setSystemTime(Date.now() + 21_000);
    release.open();
    await expectHttps(slow, 'unavailable', 'change-interrupted');
    expect(writes).toEqual([]);
    expect(await authEmail(u.uid)).toBe(u.email);
    expect(Object.keys((await ledger(u.uid)).pending ?? {})).toHaveLength(0);
    await resume(u.uid, { challengeId: r.challengeId });
    expect(await authEmail(u.uid)).toBe('x@example.test');
  });

  // ── Round 3 (review of 87fc9fe) ──────────────────────────────────────────

  it('R3-2: a repair that Auth refuses is never reported as success, and no token is issued', async () => {
    const u = await makeEmailUser();
    const r = await requestEmail(u.uid, 'b@example.test');
    emailChangeDeps.afterAuthCheck = async uid => {
      emailChangeDeps.afterAuthCheck = origAfterAuthCheck;
      await origSetAuthEmail(uid, u.email);                     // a late write puts the old address back
      await getAuth().createUser({ email: 'b@example.test' });  // the freed address is claimed by another account
    };
    await expectHttps(verifyEmail(u.uid, r.challengeId, lastCodeTo('b@example.test')), 'aborted', 'change-conflict');
    expect(await authEmail(u.uid)).toBe(u.email);
    expect((await ledger(u.uid)).conflict?.code).toBe('auth/email-already-exists');
    const audit = (await db().collection('auditLogs').get()).docs.map(d => d.data());
    expect(audit.some(a => a.action === 'emailChange.authEmailRepairRejected' && a.result === 'failure')).toBe(true);
    expect(audit.some(a => a.action === 'emailChange.authEmailRepaired' && a.result === 'success')).toBe(false);
    expect(audit.some(a => a.action === 'emailChange.completed')).toBe(false);
    // Retrying never turns it into a success …
    await expectHttps(resume(u.uid, { challengeId: r.challengeId }, { authAgeSec: -2 }), 'aborted', 'change-conflict');
    // … and the replaced address cannot sign in meanwhile.
    await requestEmailOtp.run(req(null, { email: u.email }));
    await expectHttps(verifyEmailOtp.run(req(null, { email: u.email, code: lastCodeTo(u.email) })), 'permission-denied', 'address-replaced');
  });

  it('R3-2: a repair whose outcome is unknown is not success either', async () => {
    const u = await makeEmailUser();
    const r = await requestEmail(u.uid, 'b@example.test');
    emailChangeDeps.afterAuthCheck = async uid => {
      emailChangeDeps.afterAuthCheck = origAfterAuthCheck;
      await origSetAuthEmail(uid, u.email);
      emailChangeDeps.setAuthEmail = async () => { throw Object.assign(new Error('timeout'), { code: 'app/network-timeout' }); };
    };
    await expectHttps(verifyEmail(u.uid, r.challengeId, lastCodeTo('b@example.test')), 'unavailable', 'change-interrupted');
    expect(await authEmail(u.uid)).toBe(u.email);
    emailChangeDeps.setAuthEmail = origSetAuthEmail;
    const out = await resume(u.uid, { challengeId: r.challengeId }, { authAgeSec: -2 });
    expect(out.email).toBe('b@example.test');
    expect(await authEmail(u.uid)).toBe('b@example.test');
  });

  it('R3-3: the replaced address cannot sign in by code, password or reset during a stale window, nor overwrite the settled one', async () => {
    const { u } = await stalledA({ dead: true });
    const rB = await bAfterAbandon(u);
    await verifyEmail(u.uid, rB.challengeId, lastCodeTo('b@example.test'));
    expect(await privEmail(u.uid)).toBe('b@example.test');
    expect((await ledger(u.uid)).settledEmail).toBe('b@example.test');

    // The lost worker's request for the old address lands; nobody reports it.
    await origSetAuthEmail(u.uid, 'a@example.test');
    // Email-code sign-in with the old address: refused, Auth repaired at once, profile untouched.
    await requestEmailOtp.run(req(null, { email: 'a@example.test' }));
    await expectHttps(verifyEmailOtp.run(req(null, { email: 'a@example.test', code: lastCodeTo('a@example.test') })), 'permission-denied', 'address-replaced');
    expect(await authEmail(u.uid)).toBe('b@example.test');
    expect(await privEmail(u.uid)).toBe('b@example.test');

    // Password sign-in and a password-reset email for the old address: refused (and repaired).
    await origSetAuthEmail(u.uid, 'a@example.test');
    await expect(handleBeforeSignIn({ data: { uid: u.uid, email: 'a@example.test' }, additionalUserInfo: { providerId: 'password' } }))
      .rejects.toMatchObject({ message: 'address-replaced' });
    expect(await authEmail(u.uid)).toBe('b@example.test');
    await origSetAuthEmail(u.uid, 'a@example.test');
    await expect(handleBeforeEmailSent({ emailType: 'PASSWORD_RESET', additionalUserInfo: { email: 'a@example.test' } }))
      .rejects.toMatchObject({ message: 'address-replaced' });
    expect(await authEmail(u.uid)).toBe('b@example.test');
    // Once repaired the old address resolves to no account (Firebase sends nothing); the settled one works.
    await handleBeforeEmailSent({ emailType: 'PASSWORD_RESET', additionalUserInfo: { email: 'a@example.test' } });
    await handleBeforeSignIn({ data: { uid: u.uid, email: 'b@example.test' }, additionalUserInfo: { providerId: 'password' } });
    await handleBeforeSignIn({ data: { uid: u.uid, email: 'a@example.test' }, additionalUserInfo: { providerId: 'custom' } });

    // The scheduled passes keep the settled address and only then retire the uncertain write.
    await origSetAuthEmail(u.uid, 'a@example.test');
    await runReconcilePass(Date.now() + 16 * 60_000);
    expect(await authEmail(u.uid)).toBe('b@example.test');
    expect(Object.keys((await ledger(u.uid)).uncertain ?? {})).toHaveLength(1);
    await runReconcilePass(Date.now() + 25 * 3600_000);
    expect(Object.keys((await ledger(u.uid)).uncertain ?? {})).toHaveLength(0);
    expect(await authEmail(u.uid)).toBe('b@example.test');
    expect(await privEmail(u.uid)).toBe('b@example.test');
  });

  it('R3-3: accounts that never used the change flow sign in as before', async () => {
    const u = await makeEmailUser();
    await handleBeforeSignIn({ data: { uid: u.uid, email: u.email }, additionalUserInfo: { providerId: 'password' } });
    await handleBeforeEmailSent({ emailType: 'PASSWORD_RESET', additionalUserInfo: { email: u.email } });
    expect((await emailSignIn(u.email)).uid).toBe(u.uid);
  });
});
