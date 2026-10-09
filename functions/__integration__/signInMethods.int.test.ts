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
  deliveredCode, authUserCount, num, linkReq,
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
afterEach(() => {
  vi.useRealTimers();
  emailChangeDeps.setAuthEmail = origSetAuthEmail;
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
    // Same challenge again: idempotent, same result, nothing new.
    expect(await verifyEmail(u.uid, r.challengeId, good)).toMatchObject({ changed: true, email: 'x@example.test' });
    // A fresh challenge for another address cannot be satisfied by the old code.
    await advance(61_000);
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
    await handleResumeEmailChange(req(u.uid, {}));
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
