// Adversarial tests for authenticated phone linking — Phase 1 scenarios 1, 3–8,
// 11 and 12 — through the real handlers on the Firestore + Auth emulators.
// Codes are read from the queued relay job (the mocked SMS); nothing is sent.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import type { HttpsError } from 'firebase-functions/v2/https';
import {
  db, resetEmulators, seedPhoneLinkConfig, seedRelayDevice, makeEmailUser, req, expectHttps,
  relayJobs, deliveredCode, sideEffectSnapshot, authUserCount, num, linkReq, CONSENT,
} from './harness';
import { handleRequestPhoneLinkOtp } from '../src/phoneLink/requestPhoneLinkOtp';
import { handleVerifyPhoneLinkOtp, handleResumePhoneLink, phoneLinkDeps } from '../src/phoneLink/verifyPhoneLinkOtp';
import { handleGetPhoneLinkStatus } from '../src/phoneLink/getPhoneLinkStatus';

const request = (uid: string, phone: string, o: Parameters<typeof req>[2] = {}, extra: Record<string, unknown> = {}) =>
  handleRequestPhoneLinkOtp(req(uid, linkReq(phone, extra), o));
const verify = (uid: string, challengeId: string, code: string, o: Parameters<typeof req>[2] = {}, extra: Record<string, unknown> = {}) =>
  handleVerifyPhoneLinkOtp(req(uid, { challengeId, code, ...extra }, o));

/** Move the server clock forward (Date only; timers stay real). */
async function advance(ms: number) {
  vi.setSystemTime(Date.now() + ms);
  await seedRelayDevice(); // keep the relay heartbeat fresh at the new "now"
}
const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

const origSetAuthPhone = phoneLinkDeps.setAuthPhone;
const origBeforeFinalize = phoneLinkDeps.beforeFinalize;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  await resetEmulators();
  await seedPhoneLinkConfig();
  await seedRelayDevice();
});
afterEach(() => {
  vi.useRealTimers();
  phoneLinkDeps.setAuthPhone = origSetAuthPhone;
  phoneLinkDeps.beforeFinalize = origBeforeFinalize;
});

// ── Scenario 1 ──────────────────────────────────────────────────────────────
describe('scenario 1 — caller eligibility', () => {
  it('unauthenticated callers are refused before anything else', async () => {
    await expectHttps(handleRequestPhoneLinkOtp(req(null, linkReq(num(1)))), 'unauthenticated', 'auth-required');
    await expectHttps(handleVerifyPhoneLinkOtp(req(null, { challengeId: 'a'.repeat(32), code: '123456' })), 'unauthenticated', 'auth-required');
    await expectHttps(handleResumePhoneLink(req(null, {})), 'unauthenticated', 'auth-required');
    await expectHttps(handleGetPhoneLinkStatus(req(null, {})), 'unauthenticated', 'auth-required');
    expect((await relayJobs()).length).toBe(0);
  });

  it('unverified email, disabled Auth user, suspended profile are refused', async () => {
    const unverified = await makeEmailUser({ emailVerified: false });
    await expectHttps(request(unverified.uid, num(1)), 'failed-precondition', 'email-not-verified');
    const disabled = await makeEmailUser({ disabled: true });
    await expectHttps(request(disabled.uid, num(1)), 'permission-denied', 'account-disabled');
    const suspended = await makeEmailUser({ status: 'suspended' });
    await expectHttps(request(suspended.uid, num(1)), 'permission-denied', 'account-disabled');
    expect((await relayJobs()).length).toBe(0);
  });

  it('a stale sign-in, or one revoked after sign-in, needs re-authentication', async () => {
    const u = await makeEmailUser();
    await expectHttps(request(u.uid, num(1), { authAgeSec: 601 }), 'unauthenticated', 'reauth-required');
    await getAuth().revokeRefreshTokens(u.uid);
    await advance(2000);
    await expectHttps(request(u.uid, num(1), { authAgeSec: 30 }), 'unauthenticated', 'reauth-required');
    expect((await relayJobs()).length).toBe(0);
    // A fresh sign-in after the revocation is accepted.
    await expect(request(u.uid, num(1), { authAgeSec: 0 })).resolves.toMatchObject({ ok: true });
  });

  it('phone/anonymous sign-ins and relay-device tokens are not email accounts', async () => {
    const u = await makeEmailUser();
    await expectHttps(request(u.uid, num(1), { provider: 'phone' }), 'failed-precondition', 'email-account-required');
    await expectHttps(request(u.uid, num(1), { provider: 'anonymous' }), 'failed-precondition', 'email-account-required');
    await expectHttps(request(u.uid, num(1), { claims: { relayDevice: true } }), 'permission-denied', 'not-allowed');
    expect((await relayJobs()).length).toBe(0);
  });

  it('ownership confirmation and SMS consent are both required', async () => {
    const u = await makeEmailUser();
    for (const bad of [
      { ...CONSENT, ownershipConfirmed: false }, { ...CONSENT, smsConsent: 'yes' },
      { ...CONSENT, consentVersion: 'old' }, {},
    ]) {
      await expectHttps(handleRequestPhoneLinkOtp(req(u.uid, { phoneE164: num(1), ...bad })), 'failed-precondition', 'consent-required');
    }
    expect((await relayJobs()).length).toBe(0);
  });

  it('unsupported or malformed numbers are refused before any limit or SMS', async () => {
    const u = await makeEmailUser();
    for (const bad of ['+14155550188', '+970521234567', '0599123456', '+97059912345678', 'x', '', 12345]) {
      await expectHttps(handleRequestPhoneLinkOtp(req(u.uid, linkReq(bad as string))), 'invalid-argument', 'number-not-supported');
    }
    expect((await relayJobs()).length).toBe(0);
    expect((await db().collection('smsRateLimits').get()).size).toBe(0);
  });

  it('equivalent spellings normalize to one number (one challenge, one key)', async () => {
    const u = await makeEmailUser();
    const r = await request(u.uid, '+970 (599) 100-020');
    const ch = await db().collection('phoneLinkChallenges').doc(u.uid).get();
    expect(ch.get('phoneE164')).toBe(num(20));
    expect(r.maskedPhone).toBe('+970••••••020');
    // The same number written differently hits the destination cooldown.
    const u2 = await makeEmailUser();
    await expectHttps(request(u2.uid, '+970599100020'), 'resource-exhausted', 'cooldown');
  });
});

// ── Scenario 3 ──────────────────────────────────────────────────────────────
describe('scenario 3 — volume against one number and across many numbers', () => {
  it('one account: cooldown, then hourly cap', async () => {
    const u = await makeEmailUser();
    await request(u.uid, num(30));
    const e = await expectHttps(request(u.uid, num(30)), 'resource-exhausted', 'cooldown');
    expect((e.details as { retryAfterSec: number }).retryAfterSec).toBeGreaterThan(0);
    await advance(61_000); await request(u.uid, num(30));
    await advance(61_000); await request(u.uid, num(30));
    await advance(61_000);
    await expectHttps(request(u.uid, num(30)), 'resource-exhausted', 'rate-limited');
    expect((await relayJobs('phone_link_otp')).length).toBe(3);
  });

  it('many accounts against ONE victim number: destination cooldown + hourly cap', async () => {
    const victim = num(31);
    const users = await Promise.all(Array.from({ length: 6 }, () => makeEmailUser()));
    await request(users[0].uid, victim, { ip: '198.51.100.1' });
    await expectHttps(request(users[1].uid, victim, { ip: '198.51.100.2' }), 'resource-exhausted', 'cooldown');
    await advance(61_000); await request(users[2].uid, victim, { ip: '198.51.100.3' });
    await advance(61_000); await request(users[3].uid, victim, { ip: '198.51.100.4' });
    await advance(61_000);
    await expectHttps(request(users[4].uid, victim, { ip: '198.51.100.5' }), 'resource-exhausted', 'rate-limited');
    expect((await relayJobs('phone_link_otp')).length).toBe(3);
  });

  it('one account spraying many numbers: distinct-number cap', async () => {
    const u = await makeEmailUser();
    await request(u.uid, num(32));
    await advance(61_000); await request(u.uid, num(33));
    await advance(61_000);
    await expectHttps(request(u.uid, num(34)), 'resource-exhausted', 'too-many-numbers');
    expect((await relayJobs('phone_link_otp')).length).toBe(2);
  });

  it('many accounts, many numbers, one source: per-source cap', async () => {
    await seedPhoneLinkConfig({ limits: { sourcePerHour: 3 } });
    const users = await Promise.all(Array.from({ length: 5 }, () => makeEmailUser()));
    for (let i = 0; i < 3; i++) await request(users[i].uid, num(40 + i), { ip: '192.0.2.7' });
    await expectHttps(request(users[3].uid, num(43), { ip: '192.0.2.7' }), 'resource-exhausted', 'service-busy');
    // A spoofed left-most X-Forwarded-For entry does not open a new bucket.
    await expectHttps(request(users[3].uid, num(43), { xff: '10.9.9.9, 192.0.2.7' }), 'resource-exhausted', 'service-busy');
    // Same IPv6 /64, different interface id → same bucket.
    await seedPhoneLinkConfig({ limits: { sourcePerHour: 1 } });
    await resetSourceOnly();
    await request(users[3].uid, num(44), { ip: '2001:db8:1:2::1' });
    await expectHttps(request(users[4].uid, num(45), { ip: '2001:db8:1:2:ffff::9' }), 'resource-exhausted', 'service-busy');
    expect((await relayJobs('phone_link_otp')).length).toBe(4);
  });

  it('global budget caps everything, whatever the account/number/source', async () => {
    await seedPhoneLinkConfig({ limits: { globalPerHour: 2 } });
    const users = await Promise.all(Array.from({ length: 3 }, () => makeEmailUser()));
    await request(users[0].uid, num(50), { ip: '203.0.113.1' });
    await request(users[1].uid, num(51), { ip: '203.0.113.2' });
    await expectHttps(request(users[2].uid, num(52), { ip: '203.0.113.3' }), 'resource-exhausted', 'service-busy');
    expect((await relayJobs('phone_link_otp')).length).toBe(2);
  });

  it('limit overrides cannot be raised above the hard ceiling', async () => {
    await seedPhoneLinkConfig({ limits: { accountPerHour: 1e9, accountCooldownSec: 0 } });
    const u = await makeEmailUser();
    await request(u.uid, num(53));
    await expectHttps(request(u.uid, num(53)), 'resource-exhausted', 'cooldown'); // floor 30s
  });
});

async function resetSourceOnly() {
  const docs = await db().collection('smsRateLimits').get();
  await Promise.all(docs.docs.filter(d => d.id.startsWith('src_') || d.id.startsWith('global')).map(d => d.ref.delete()));
}

// ── Scenario 4 ──────────────────────────────────────────────────────────────
describe('scenario 4 — parallel requests cannot bypass limits', () => {
  it('20 parallel requests from one account → exactly one SMS', async () => {
    const u = await makeEmailUser();
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => request(u.uid, num(60))));
    const ok = results.filter(r => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    expect((await relayJobs('phone_link_otp')).length).toBe(1);
  });

  it('parallel requests from many accounts to one number → exactly one SMS', async () => {
    const users = await Promise.all(Array.from({ length: 8 }, () => makeEmailUser()));
    const results = await Promise.allSettled(users.map((u, i) => request(u.uid, num(61), { ip: `198.51.100.${i + 20}` })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await relayJobs('phone_link_otp')).length).toBe(1);
  });

  it('parallel requests never overshoot the global budget', async () => {
    await seedPhoneLinkConfig({ limits: { globalPerHour: 3 } });
    const users = await Promise.all(Array.from({ length: 10 }, () => makeEmailUser()));
    const results = await Promise.allSettled(users.map((u, i) => request(u.uid, num(70 + i), { ip: `198.51.100.${i + 40}` })));
    const ok = results.filter(r => r.status === 'fulfilled').length;
    const jobs = (await relayJobs('phone_link_otp')).length;
    expect(jobs).toBe(ok);
    expect(jobs).toBeLessThanOrEqual(3);
    expect(jobs).toBeGreaterThanOrEqual(1);
    const g = await db().collection('smsRateLimits').doc('global_phoneLink').get();
    expect(g.get('h').c).toBe(jobs);
  });
});

// ── Scenario 5 ──────────────────────────────────────────────────────────────
describe('scenario 5 — guessing, expiry, replay, simultaneous verification', () => {
  it('wrong codes burn the challenge after maxVerifyAttempts; then even the right code fails', async () => {
    const u = await makeEmailUser();
    const r = await request(u.uid, num(80));
    const code = await deliveredCode(r.challengeId);
    for (let left = 4; left >= 1; left--) {
      const e = await expectHttps(verify(u.uid, r.challengeId, wrong(code)), 'permission-denied', 'code-invalid');
      expect((e.details as { attemptsLeft: number }).attemptsLeft).toBe(left);
    }
    await expectHttps(verify(u.uid, r.challengeId, wrong(code)), 'resource-exhausted', 'too-many-attempts');
    await expectHttps(verify(u.uid, r.challengeId, code), 'not-found', 'challenge-not-found');
    expect((await sideEffectSnapshot(u.uid)).claims).toBe(0);
  });

  // Parallel wrong guesses race on ONE challenge document. Each guess is
  // evaluated and counted inside the same transaction; when the transaction
  // can't commit (the emulator — like production — aborts lock-contended
  // transactions: "10 ABORTED: Transaction lock timeout", and the Admin SDK
  // gives up after its retries) the caller gets the retryable
  // `link-interrupted` and that guess was never evaluated. How many of a
  // 30-way burst abort depends on timing, so the test must not assume every
  // request was evaluated (it used to, and intermittently saw `pending`).
  // Instead it checks, deterministically, that NO guess is ever answered
  // without being counted, then lets the attacker keep retrying until the
  // challenge locks — exactly at the budget, never beyond it.
  it('parallel guessing cannot exceed the attempt budget', async () => {
    const MAX = 5;
    const u = await makeEmailUser();
    const r = await request(u.uid, num(81));
    const code = await deliveredCode(r.challengeId);
    const guesses = Array.from({ length: 30 }, (_, i) => String(i).padStart(6, '0')).filter(g => g !== code);

    type Outcome = 'invalid' | 'burned' | 'refused' | 'interrupted';
    const classify = (x: PromiseSettledResult<unknown>): Outcome => {
      // A wrong code can never succeed.
      expect(x.status, 'a wrong guess was accepted').toBe('rejected');
      const e = (x as PromiseRejectedResult).reason as HttpsError;
      const k = `${e.code}/${e.message}`;
      if (k === 'permission-denied/code-invalid') return 'invalid';          // evaluated + counted
      if (k === 'resource-exhausted/too-many-attempts') return 'burned';     // evaluated + counted (the lock) or refused at budget
      if (k === 'not-found/challenge-not-found') return 'refused';           // challenge already locked
      if (k === 'unavailable/link-interrupted') return 'interrupted';        // transaction aborted: not evaluated
      throw new Error(`unexpected outcome ${k}`);
    };
    const attemptsNow = async () => ((await db().collection('phoneLinkChallenges').doc(u.uid).get()).get('attempts') as number) ?? 0;

    // 1. The parallel burst.
    const burst = (await Promise.allSettled(guesses.map(g => verify(u.uid, r.challengeId, g)))).map(classify);
    const n = (o: Outcome, list = burst) => list.filter(x => x === o).length;
    const afterBurst = await attemptsNow();
    expect(afterBurst).toBeLessThanOrEqual(MAX);
    // Every "code-invalid" answer corresponds to a committed attempt, and the
    // counter never moved for a guess that wasn't answered as evaluated.
    expect(n('invalid')).toBe(Math.min(afterBurst, MAX - 1));
    expect(afterBurst - n('invalid')).toBeLessThanOrEqual(n('burned'));

    // 2. The attacker retries every interrupted guess (one at a time, so each
    //    is evaluated) until the challenge refuses everything.
    const retried: Outcome[] = [];
    for (const [i, g] of guesses.entries()) {
      if (burst[i] !== 'interrupted') continue;
      const o = classify((await Promise.allSettled([verify(u.uid, r.challengeId, g)]))[0]);
      expect(o, 'a sequential retry was interrupted').not.toBe('interrupted');
      retried.push(o);
    }

    // 3. Exactly the budget was spent across burst + retries — never more.
    const ch = await db().collection('phoneLinkChallenges').doc(u.uid).get();
    expect(ch.get('attempts')).toBe(MAX);
    expect(ch.get('status')).toBe('locked');
    expect(n('invalid') + n('invalid', retried)).toBe(MAX - 1);
    // ...and even the right code is refused now.
    await expectHttps(verify(u.uid, r.challengeId, code), 'not-found', 'challenge-not-found');
  });

  it('a contention abort evaluates nothing: forced 100-way burst', async () => {
    // Deliberately provoke lock-timeout aborts (most of a 100-way burst aborts
    // on the emulator) to pin down the interrupted path: whatever aborts, the
    // committed counter matches exactly the guesses answered as evaluated, and
    // the budget is never exceeded.
    const u = await makeEmailUser();
    const r = await request(u.uid, num(83));
    const code = await deliveredCode(r.challengeId);
    const burst = Array.from({ length: 100 }, (_, i) => String(100 + i).padStart(6, '0')).filter(g => g !== code);
    const keys = (await Promise.allSettled(burst.map(g => verify(u.uid, r.challengeId, g))))
      .map(x => (x.status === 'fulfilled' ? 'ok' : `${(x.reason as HttpsError).code}/${(x.reason as HttpsError).message}`));
    const count = (k: string) => keys.filter(x => x === k).length;
    for (const k of keys) {
      expect(['permission-denied/code-invalid', 'resource-exhausted/too-many-attempts',
        'not-found/challenge-not-found', 'unavailable/link-interrupted']).toContain(k);
    }
    const ch = await db().collection('phoneLinkChallenges').doc(u.uid).get();
    const attempts = (ch.get('attempts') as number) ?? 0;
    expect(attempts).toBeLessThanOrEqual(5);
    expect(count('permission-denied/code-invalid')).toBe(Math.min(attempts, 4));
    expect(ch.get('status')).toBe(attempts === 5 ? 'locked' : 'pending');
    // Unspent budget stays usable by the owner; a spent one refuses even the right code.
    if (attempts === 5) await expectHttps(verify(u.uid, r.challengeId, code), 'not-found', 'challenge-not-found');
    else await expect(verify(u.uid, r.challengeId, code)).resolves.toMatchObject({ linked: true });
  });

  it('account-wide wrong-code cap spans challenges', async () => {
    await seedPhoneLinkConfig({ limits: { accountVerifyFailuresPerDay: 3, maxVerifyAttempts: 2 } });
    const u = await makeEmailUser();
    const r1 = await request(u.uid, num(82));
    const c1 = await deliveredCode(r1.challengeId);
    await expectHttps(verify(u.uid, r1.challengeId, wrong(c1)), 'permission-denied', 'code-invalid');
    await expectHttps(verify(u.uid, r1.challengeId, wrong(c1)), 'resource-exhausted', 'too-many-attempts');
    await advance(61_000);
    const r2 = await request(u.uid, num(82));
    const c2 = await deliveredCode(r2.challengeId);
    await expectHttps(verify(u.uid, r2.challengeId, wrong(c2)), 'permission-denied', 'code-invalid');
    await expectHttps(verify(u.uid, r2.challengeId, c2), 'resource-exhausted', 'too-many-attempts');
  });

  it('an expired code is refused and cannot be revived', async () => {
    const u = await makeEmailUser();
    const r = await request(u.uid, num(83));
    const code = await deliveredCode(r.challengeId);
    await advance(301_000);
    await expectHttps(verify(u.uid, r.challengeId, code, { authAgeSec: 5 }), 'deadline-exceeded', 'code-expired');
    await expectHttps(verify(u.uid, r.challengeId, code, { authAgeSec: 5 }), 'deadline-exceeded', 'code-expired');
    expect((await sideEffectSnapshot(u.uid)).authPhone).toBeNull();
  });

  it('a used code cannot be replayed to do anything new', async () => {
    const u = await makeEmailUser();
    const r = await request(u.uid, num(84));
    const code = await deliveredCode(r.challengeId);
    await expect(verify(u.uid, r.challengeId, code)).resolves.toMatchObject({ linked: true });
    const after = await sideEffectSnapshot(u.uid);
    const auditN = (await db().collection('auditLogs').get()).size;
    // Same caller retrying the same challenge (lost response) → idempotent
    // result, no new writes, even with a garbage code.
    await expect(verify(u.uid, r.challengeId, code)).resolves.toMatchObject({ linked: true });
    await expect(verify(u.uid, r.challengeId, '999999')).resolves.toMatchObject({ linked: true });
    expect(await sideEffectSnapshot(u.uid)).toEqual(after);
    expect((await db().collection('auditLogs').get()).size).toBe(auditN);
    // Anyone else replaying the code gets nothing.
    const other = await makeEmailUser();
    await expectHttps(verify(other.uid, r.challengeId, code), 'not-found', 'challenge-not-found');
    expect((await sideEffectSnapshot(other.uid)).authPhone).toBeNull();
  });

  it('a newer code invalidates the older one (and cancels its unsent SMS)', async () => {
    const u = await makeEmailUser();
    const r1 = await request(u.uid, num(85));
    const c1 = await deliveredCode(r1.challengeId);
    await advance(61_000);
    const r2 = await request(u.uid, num(85));
    expect((await db().collection('relayJobs').doc(`plink_${r1.challengeId}`).get()).get('lastError')).toBe('superseded');
    await expectHttps(verify(u.uid, r1.challengeId, c1), 'not-found', 'challenge-not-found');
    const c2 = await deliveredCode(r2.challengeId);
    await expect(verify(u.uid, r2.challengeId, c2)).resolves.toMatchObject({ linked: true });
  });

  it('an infrastructure failure of the acceptance transaction is reported as retryable link-interrupted, never a raw error', async () => {
    const u = await makeEmailUser();
    const r = await request(u.uid, num(87));
    const code = await deliveredCode(r.challengeId);
    // Exactly what the Firestore emulator returned to a losing concurrent verify in CI.
    const spy = vi.spyOn(db(), 'runTransaction')
      .mockRejectedValueOnce(new Error('3 INVALID_ARGUMENT: Transaction is invalid or closed.'));
    await expectHttps(verify(u.uid, r.challengeId, code), 'unavailable', 'link-interrupted');
    spy.mockRestore();
    // Nothing was committed: resume finds no accepted op, and the same code still links once.
    await expectHttps(handleResumePhoneLink(req(u.uid, {})), 'not-found', 'challenge-not-found');
    await expect(verify(u.uid, r.challengeId, code)).resolves.toMatchObject({ linked: true });
    expect(await sideEffectSnapshot(u.uid)).toMatchObject({ claims: 1, privatePhone: num(87), phoneVerified: true });
  });

  it('simultaneous correct verifications link once, consistently', async () => {
    const u = await makeEmailUser();
    const r = await request(u.uid, num(86));
    const code = await deliveredCode(r.challengeId);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => verify(u.uid, r.challengeId, code)));
    expect(results.some(x => x.status === 'fulfilled')).toBe(true);
    for (const x of results) {
      if (x.status === 'rejected') expect((x.reason as Error).message).toBe('link-interrupted');
    }
    await handleResumePhoneLink(req(u.uid, {}));
    const s = await sideEffectSnapshot(u.uid);
    expect(s).toMatchObject({ claims: 1, authPhone: num(86), privatePhone: num(86), phoneVerified: true, balance: 50 });
  });
});

// ── Scenario 6 ──────────────────────────────────────────────────────────────
describe("scenario 6 — another user's challenge, changed destination", () => {
  it("B cannot verify A's challenge, and A's challenge is untouched", async () => {
    const a = await makeEmailUser();
    const b = await makeEmailUser();
    const r = await request(a.uid, num(90));
    const code = await deliveredCode(r.challengeId);
    await expectHttps(verify(b.uid, r.challengeId, code), 'not-found', 'challenge-not-found');
    const ch = await db().collection('phoneLinkChallenges').doc(a.uid).get();
    expect(ch.get('attempts')).toBe(0);
    expect(ch.get('status')).toBe('pending');
    expect((await sideEffectSnapshot(b.uid)).authPhone).toBeNull();
    await expect(verify(a.uid, r.challengeId, code)).resolves.toMatchObject({ linked: true });
  });

  it('a client-supplied number at verify time is ignored: the challenged number is linked', async () => {
    const u = await makeEmailUser();
    const r = await request(u.uid, num(91));
    const code = await deliveredCode(r.challengeId);
    await verify(u.uid, r.challengeId, code, {}, { phoneE164: num(92) });
    expect((await getAuth().getUser(u.uid)).phoneNumber).toBe(num(91));
  });

  it('a code issued for number X cannot verify a later challenge for number Y', async () => {
    const u = await makeEmailUser();
    const rx = await request(u.uid, num(93));
    const cx = await deliveredCode(rx.challengeId);
    await advance(61_000);
    const ry = await request(u.uid, num(94));
    const cy = await deliveredCode(ry.challengeId);
    if (cx !== cy) await expectHttps(verify(u.uid, ry.challengeId, cx), 'permission-denied', 'code-invalid');
    await expectHttps(verify(u.uid, rx.challengeId, cx), 'not-found', 'challenge-not-found');
  });

  it('a forged challenge id is refused', async () => {
    const u = await makeEmailUser();
    await request(u.uid, num(95));
    await expectHttps(verify(u.uid, 'f'.repeat(32), '123456'), 'not-found', 'challenge-not-found');
    await expectHttps(verify(u.uid, '../phoneClaims/x', '123456'), 'not-found', 'challenge-not-found');
  });
});

// ── Scenario 7 ──────────────────────────────────────────────────────────────
describe('scenario 7 — two accounts, one number', () => {
  it('concurrent verification by two accounts: exactly one wins, the other gets a generic refusal', async () => {
    const a = await makeEmailUser();
    const b = await makeEmailUser();
    const ra = await request(a.uid, num(100), { ip: '198.51.100.70' });
    await advance(61_000);
    const rb = await request(b.uid, num(100), { ip: '198.51.100.71' });
    const [ca, cb] = await Promise.all([deliveredCode(ra.challengeId), deliveredCode(rb.challengeId)]);
    const results = await Promise.allSettled([verify(a.uid, ra.challengeId, ca), verify(b.uid, rb.challengeId, cb)]);
    const wins = results.filter(r => r.status === 'fulfilled');
    expect(wins).toHaveLength(1);
    const loss = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(loss.reason.message).toBe('phone-unavailable');
    expect(JSON.stringify(loss.reason.details ?? null)).not.toMatch(new RegExp(`${a.uid}|${b.uid}|@`));
    const holders = (await getAuth().listUsers()).users.filter(x => x.phoneNumber === num(100));
    expect(holders).toHaveLength(1);
    const claims = await db().collection('phoneClaims').get();
    expect(claims.size).toBe(1);
    expect(claims.docs[0].get('uid')).toBe(holders[0].uid);
  });

  it('a number already held by a legacy phone account is unavailable — no SMS, no identity', async () => {
    await makeEmailUser({ phoneNumber: num(101) });
    const u = await makeEmailUser();
    const before = await sideEffectSnapshot(u.uid);
    const e = await expectHttps(request(u.uid, num(101)), 'already-exists', 'phone-unavailable');
    expect(e.details).toBeUndefined();
    expect(await sideEffectSnapshot(u.uid)).toEqual(before);
    // ...and the probe counts against the account (enumeration is rate-limited).
    await expectHttps(request(u.uid, num(102)), 'resource-exhausted', 'cooldown');
  });

  it('a claim left by a deleted account does not block the real owner', async () => {
    const gone = await makeEmailUser();
    const r = await request(gone.uid, num(103));
    await verify(gone.uid, r.challengeId, await deliveredCode(r.challengeId));
    await getAuth().deleteUser(gone.uid); // simulate deletion without claim cleanup
    await advance(61_000);
    const u = await makeEmailUser();
    const r2 = await request(u.uid, num(103));
    await expect(verify(u.uid, r2.challengeId, await deliveredCode(r2.challengeId))).resolves.toMatchObject({ linked: true });
  });
});

// ── Scenario 8 ──────────────────────────────────────────────────────────────
describe('scenario 8 — interruption after partial success, then retry', () => {
  it('Auth update fails → link-interrupted; resume completes without a new code or SMS', async () => {
    const u = await makeEmailUser();
    const r = await request(u.uid, num(110));
    const code = await deliveredCode(r.challengeId);
    phoneLinkDeps.setAuthPhone = async () => { throw Object.assign(new Error('deadline'), { code: 'auth/internal-error' }); };
    await expectHttps(verify(u.uid, r.challengeId, code), 'unavailable', 'link-interrupted');
    let s = await sideEffectSnapshot(u.uid);
    expect(s).toMatchObject({ authPhone: null, privatePhone: null, claims: 1, relayJobs: 1 });
    expect((await db().collection('phoneLinkOps').doc(u.uid).get()).get('stage')).toBe('claimed');
    // A new request is blocked until the pending link is resolved.
    await advance(61_000);
    await expectHttps(request(u.uid, num(111)), 'failed-precondition', 'link-pending-recovery');
    expect((await handleGetPhoneLinkStatus(req(u.uid, {}))) ).toMatchObject({ pendingRecovery: true });

    phoneLinkDeps.setAuthPhone = origSetAuthPhone;
    await expect(handleResumePhoneLink(req(u.uid, {}))).resolves.toMatchObject({ linked: true });
    s = await sideEffectSnapshot(u.uid);
    expect(s).toMatchObject({ authPhone: num(110), privatePhone: num(110), phoneVerified: true, claims: 1, relayJobs: 1 });
    // Idempotent: resuming again is harmless.
    await expect(handleResumePhoneLink(req(u.uid, {}))).resolves.toMatchObject({ linked: true });
  });

  it('Firestore finalize fails after Auth succeeded → retrying verify with the same challenge finishes', async () => {
    const u = await makeEmailUser();
    const r = await request(u.uid, num(112));
    const code = await deliveredCode(r.challengeId);
    phoneLinkDeps.beforeFinalize = async () => { throw new Error('connection reset'); };
    await expectHttps(verify(u.uid, r.challengeId, code), 'unavailable', 'link-interrupted');
    expect((await getAuth().getUser(u.uid)).phoneNumber).toBe(num(112));
    expect((await sideEffectSnapshot(u.uid)).privatePhone).toBeNull();
    phoneLinkDeps.beforeFinalize = origBeforeFinalize;
    await expect(verify(u.uid, r.challengeId, code)).resolves.toMatchObject({ linked: true });
    expect((await sideEffectSnapshot(u.uid)).privatePhone).toBe(num(112));
  });

  it('Auth reports the number taken (legacy holder appeared) → claim released, generic refusal', async () => {
    const u = await makeEmailUser();
    const r = await request(u.uid, num(113));
    const code = await deliveredCode(r.challengeId);
    await makeEmailUser({ phoneNumber: num(113) }); // appears after the code was sent
    await expectHttps(verify(u.uid, r.challengeId, code), 'already-exists', 'phone-unavailable');
    const s = await sideEffectSnapshot(u.uid);
    expect(s).toMatchObject({ claims: 0, authPhone: null, privatePhone: null, phoneVerified: null });
    expect((await db().collection('phoneLinkOps').doc(u.uid).get()).get('stage')).toBe('failed');
  });
});

// ── J (R6) ─────────────────────────────────────────────────────────────────
describe('J (R6) — a late worker can never downgrade a completed link', () => {
  it('worker A finishes, worker B arrives late and crashes; state stays done and resume is idempotent', async () => {
    const u = await makeEmailUser();
    const r = await request(u.uid, num(140));
    const c = await deliveredCode(r.challengeId);
    // Leave the op at `claimed` (first attempt interrupted at the Auth step).
    phoneLinkDeps.setAuthPhone = async () => { throw Object.assign(new Error('x'), { code: 'auth/internal-error' }); };
    await expectHttps(verify(u.uid, r.challengeId, c), 'unavailable', 'link-interrupted');

    // Whichever worker reaches the Auth step SECOND is held there (it keeps the
    // pre-completion state in memory) while the other finishes; it then resumes
    // and crashes before finalizing. Order-independent: the scheduler decides
    // which call gets there first (the old version assumed A always did and
    // deadlocked when B won).
    let calls = 0;
    let releaseLate!: () => void;
    const lateGate = new Promise<void>(res => { releaseLate = res; });
    phoneLinkDeps.setAuthPhone = async (uid, e164) => {
      const me = ++calls;
      await origSetAuthPhone(uid, e164);
      if (me === 2) await lateGate;
    };
    let finals = 0;
    phoneLinkDeps.beforeFinalize = async () => { if (finals++ === 1) throw new Error('late worker crashed'); };

    const settle = (p: Promise<unknown>) => p.then(v => ({ ok: true as const, v }), (e: Error) => ({ ok: false as const, e }));
    const workers = [settle(handleResumePhoneLink(req(u.uid, {}))), settle(handleResumePhoneLink(req(u.uid, {})))];
    const first = await Promise.race(workers); // the gated late worker cannot finish first
    expect(first).toMatchObject({ ok: true, v: { linked: true } });
    expect((await db().collection('phoneLinkOps').doc(u.uid).get()).get('stage')).toBe('done');
    releaseLate();
    await Promise.all(workers); // the late worker's crash is reported as link-interrupted
    const op = (await db().collection('phoneLinkOps').doc(u.uid).get()).data()!;
    expect(op.stage).toBe('done');            // not downgraded to auth-updated
    expect(op.phoneE164).toBeUndefined();     // and still terminal/cleaned
    phoneLinkDeps.beforeFinalize = origBeforeFinalize;
    phoneLinkDeps.setAuthPhone = origSetAuthPhone;
    await expect(handleResumePhoneLink(req(u.uid, {}))).resolves.toMatchObject({ linked: true });
    expect(await sideEffectSnapshot(u.uid)).toMatchObject({ authPhone: num(140), privatePhone: num(140), claims: 1, relayJobs: 1 });
  });

  it('an op already corrupted by the old race (non-terminal, number missing) is repaired without a new code or SMS', async () => {
    const u = await makeEmailUser();
    const r = await request(u.uid, num(141));
    const c = await deliveredCode(r.challengeId);
    phoneLinkDeps.beforeFinalize = async () => { throw new Error('crash'); };
    await expectHttps(verify(u.uid, r.challengeId, c), 'unavailable', 'link-interrupted');
    phoneLinkDeps.beforeFinalize = origBeforeFinalize;
    // Reproduce the pre-fix corruption: auth-updated without phoneE164.
    await db().collection('phoneLinkOps').doc(u.uid).update({ stage: 'auth-updated', phoneE164: FieldValue.delete() });
    await expect(handleResumePhoneLink(req(u.uid, {}))).resolves.toMatchObject({ linked: true });
    expect(await sideEffectSnapshot(u.uid)).toMatchObject({ authPhone: num(141), privatePhone: num(141), relayJobs: 1 });
  });
});

// ── Scenarios 11 & 12 ───────────────────────────────────────────────────────
describe('scenario 11 — the existing account is preserved', () => {
  it('same uid, same profile/wallet/memberships, no new account, only phone fields added', async () => {
    const u = await makeEmailUser();
    const usersBefore = await authUserCount();
    const profileBefore = (await db().collection('users').doc(u.uid).get()).data()!;
    const convBefore = (await db().collection('conversations').doc(`grp-${u.uid}`).get()).data();
    const r = await request(u.uid, num(120));
    const res = await verify(u.uid, r.challengeId, await deliveredCode(r.challengeId));
    expect(res).toEqual({ linked: true, maskedPhone: '+970••••••120' });
    expect(await authUserCount()).toBe(usersBefore);
    const authUser = await getAuth().getUser(u.uid);
    expect(authUser.email).toBe(u.email);
    expect(authUser.emailVerified).toBe(true);
    const profileAfter = (await db().collection('users').doc(u.uid).get()).data()!;
    const { phoneVerified, updatedAt, ...rest } = profileAfter;
    expect(phoneVerified).toBe(true);
    expect(updatedAt).toBeDefined();
    expect(rest).toEqual(profileBefore);
    expect((await db().collection('wallets').doc(u.uid).get()).data()).toEqual({ balance: 50, reserved: 0 });
    expect((await db().collection('conversations').doc(`grp-${u.uid}`).get()).data()).toEqual(convBefore);
    const priv = (await db().collection('users').doc(u.uid).collection('userPrivate').doc('profile').get()).data()!;
    expect(priv.email).toBe(u.email);
    expect(priv.phoneNumber).toBe(num(120));
    // The public profile never carries the number.
    expect(JSON.stringify(profileAfter)).not.toContain('599100120');
  });
});

describe('scenario 12 — rejected operations have no SMS / link / balance side effects', () => {
  it('a battery of rejected calls leaves delivery, link state and balances untouched', async () => {
    const u = await makeEmailUser();
    const victim = num(130);
    const before = await sideEffectSnapshot(u.uid);
    const attempts: Array<() => Promise<unknown>> = [
      () => request(u.uid, victim, { authAgeSec: 9999 }),
      () => request(u.uid, victim, { provider: 'phone' }),
      () => request(u.uid, victim, {}, { purpose: 'signin' }),
      () => handleRequestPhoneLinkOtp(req(u.uid, { phoneE164: victim })),
      () => request(u.uid, '+14155550188'),
      () => verify(u.uid, 'a'.repeat(32), '123456'),
      () => verify(u.uid, 'a'.repeat(32), 'abc'),
      () => handleResumePhoneLink(req(u.uid, {})),
    ];
    for (const call of attempts) await expect(call()).rejects.toBeTruthy();
    expect(await sideEffectSnapshot(u.uid)).toEqual(before);
    expect((await db().collection('phoneLinkChallenges').get()).size).toBe(0);
  });

  it('status endpoint hides the feature entirely while it is off', async () => {
    const u = await makeEmailUser();
    await seedPhoneLinkConfig({ enabled: false });
    await expect(handleGetPhoneLinkStatus(req(u.uid, {}))).resolves.toEqual({ available: false });
  });

  it('audit rows and challenge docs never contain the number or the code', async () => {
    const u = await makeEmailUser();
    const r = await request(u.uid, num(131));
    const code = await deliveredCode(r.challengeId);
    await verify(u.uid, r.challengeId, wrong(code)).catch(() => {});
    await verify(u.uid, r.challengeId, code);
    const audit = JSON.stringify((await db().collection('auditLogs').get()).docs.map(d => d.data()));
    expect(audit).not.toContain('599100131');
    expect(audit).not.toContain(code);
    const ch = (await db().collection('phoneLinkChallenges').doc(u.uid).get()).data()!;
    expect(JSON.stringify(ch)).not.toContain(code);
    expect(ch.codeVerifier).toBeUndefined(); // dropped once used
    const job = (await db().collection('relayJobs').doc(`plink_${r.challengeId}`).get()).data()!;
    expect(job.messageBody).toContain(code); // only the outbound SMS body holds it, until a terminal report
  });
});
