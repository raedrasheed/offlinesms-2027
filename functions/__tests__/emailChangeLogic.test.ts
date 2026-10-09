import { describe, expect, it } from 'vitest';
import {
  emailChangeVerifier, emailChangeCodeMatches, checkEmailChangeAccount, applyEmailChangeAccount,
  emailChangeVerifyExhausted, applyEmailChangeVerifyFailure, maskEmail, EMAIL_CHANGE_LIMITS as L,
} from '../src/emailChange/logic';
import { hasVerifiedSignInMethod, authFreshness } from '../src/phoneLink/gates';
import { liveWrites, writeOutcomeUnknown, ABANDON_MS } from '../src/emailChange/authWrites';
import { renderOtpEmail } from '../src/lib/email/template';

const b = { challengeId: 'a'.repeat(32), uid: 'u1', emailKey: 'k1' };

describe('email change code binding', () => {
  it('accepts the right code only for the same challenge, account and address', () => {
    const v = emailChangeVerifier(b, '123456', 'salt');
    expect(emailChangeCodeMatches(b, '123456', 'salt', v)).toBe(true);
    expect(emailChangeCodeMatches(b, '123457', 'salt', v)).toBe(false);
    expect(emailChangeCodeMatches({ ...b, uid: 'u2' }, '123456', 'salt', v)).toBe(false);
    expect(emailChangeCodeMatches({ ...b, emailKey: 'k2' }, '123456', 'salt', v)).toBe(false);
    expect(emailChangeCodeMatches({ ...b, challengeId: 'b'.repeat(32) }, '123456', 'salt', v)).toBe(false);
    expect(emailChangeCodeMatches(b, '123456', undefined, v)).toBe(false);
    expect(emailChangeCodeMatches(b, '123456', 'salt', undefined)).toBe(false);
  });
});

describe('email change account limits', () => {
  it('cooldown, hourly cap and distinct-address cap', () => {
    let a = {};
    const t0 = 1_000_000_000;
    expect(checkEmailChangeAccount(a, 'k1', t0)).toBeNull();
    a = applyEmailChangeAccount(a, 'k1', t0);
    expect(checkEmailChangeAccount(a, 'k1', t0 + 1000)?.code).toBe('cooldown');
    let t = t0;
    for (let i = 1; i < L.accountPerHour; i++) { t += 61_000; a = applyEmailChangeAccount(a, 'k1', t); }
    expect(checkEmailChangeAccount(a, 'k1', t + 61_000)?.code).toBe('rate-limited');
    let c = {};
    for (let i = 0; i < L.accountDistinctEmailsPerDay; i++) c = applyEmailChangeAccount(c, `k${i}`, t0 + i * 3_700_000);
    expect(checkEmailChangeAccount(c, 'other', t0 + 4 * 3_700_000)?.code).toBe('too-many-numbers');
  });
  it('wrong-code budget per day', () => {
    let a = {};
    for (let i = 0; i < L.accountVerifyFailuresPerDay; i++) a = applyEmailChangeVerifyFailure(a, 1000 + i);
    expect(emailChangeVerifyExhausted(a, 2000)).toBe(true);
  });
});

describe('helpers', () => {
  it('a verified email or a phone number counts as a verified sign-in method', () => {
    expect(hasVerifiedSignInMethod({ email: 'a@b.co', emailVerified: true })).toBe(true);
    expect(hasVerifiedSignInMethod({ phoneNumber: '+970599100001' })).toBe(true);
    expect(hasVerifiedSignInMethod({ email: 'a@b.co', emailVerified: false })).toBe(false);
    expect(hasVerifiedSignInMethod({})).toBe(false);
  });
  it('masks the address', () => {
    expect(maskEmail('sara@example.com')).toBe('sa•••@example.com');
    expect(maskEmail('bad')).toBe('•••');
  });
  it('the add-email message says what the code is for', () => {
    const m = renderOtpEmail({ code: '123456', ttlMinutes: 10, purpose: 'add-email' });
    expect(m.subject).toMatch(/Confirm your email/);
    expect(m.text).toContain('add this email address');
    expect(m.text).toContain('123456');
    expect(renderOtpEmail({ code: '1', ttlMinutes: 10 }).subject).toBe('Your OfflineSMS verification code');
  });
});

describe('revoked sessions (pure, R4-1)', () => {
  const signedIn = Date.parse('2026-10-09T17:00:20Z') / 1000;
  const now = Date.parse('2026-10-09T17:00:40Z');
  const at = (sec: number) => new Date(sec * 1000).toUTCString();
  it('any revocation after the sign-in ends the session, whichever operation caused it', () => {
    // The change's own marker (17:00:30) and an independent one (17:00:31) are treated alike.
    expect(authFreshness(signedIn, now, L.reauthMaxAgeSec + L.codeTtlSec, at(signedIn + 10))).toBe('reauth-required');
    expect(authFreshness(signedIn, now, L.reauthMaxAgeSec + L.codeTtlSec, at(signedIn + 11))).toBe('reauth-required');
  });
  it('a sign-in after the revocation is a fresh session', () => {
    expect(authFreshness(signedIn + 12, now, L.reauthMaxAgeSec + L.codeTtlSec, at(signedIn + 11))).toBe('ok');
  });
});

describe('Auth-write ledger (pure)', () => {
  const t0 = 1_000_000_000;
  it('only live pending writes block; abandoned ones do not', () => {
    expect(liveWrites(undefined, t0).count).toBe(0);
    const l = { pending: { a: { email: 'a@x.y', challengeId: 'c', kind: 'change' as const, atMs: t0 } } };
    expect(liveWrites(l, t0 + 1_000)).toEqual({ count: 1, retryAfterSec: 599 });
    expect(liveWrites(l, t0 + ABANDON_MS).count).toBe(0);
  });
  it('only definite Auth refusals count as a certain outcome', () => {
    expect(writeOutcomeUnknown({ code: 'auth/email-already-exists' })).toBe(false);
    expect(writeOutcomeUnknown({ code: 'auth/invalid-email' })).toBe(false);
    expect(writeOutcomeUnknown({ code: 'auth/internal-error' })).toBe(true);
    expect(writeOutcomeUnknown({ code: 'app/network-timeout' })).toBe(true);
    expect(writeOutcomeUnknown(new Error('ECONNRESET'))).toBe(true);
  });
});
