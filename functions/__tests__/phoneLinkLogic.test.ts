// Pure-logic tests for phone linking: config resolution, counters, request-
// source bucketing, keyed hashing/code binding, freshness and number rules.
// The emulator suite (functions/__integration__) covers the handlers.

import { describe, it, expect } from 'vitest';
import {
  resolvePhoneLinkConfig, resolveLimits, phoneLinkEnvEnabled, phoneLinkSendingAllowed,
  DEFAULT_LIMITS, LIMIT_BOUNDS,
} from '../src/phoneLink/config';
import {
  windowCount, bumpWindow, distinctAllows, addDistinct, checkAccount, applyAccount,
  checkDestination, applyDestination, checkWindows, applyWindows,
  verifyFailuresExhausted, applyVerifyFailure, HOUR_MS, DAY_MS,
} from '../src/phoneLink/limits';
import { trustedClientIp, sourceBucket, UNKNOWN_SOURCE } from '../src/phoneLink/requestSource';
import {
  phoneHmac, sourceHmac, codeVerifier, verifyCode, generateCode, newChallengeId,
  assertPepper, maskPhone, auditTag,
} from '../src/phoneLink/crypto';
import { authFreshness, profileIsActive } from '../src/phoneLink/gates';
import { normalizeLinkNumber } from '../src/phoneLink/shared';
import {
  failureOutcome, reapDecision, verificationClaimDecision, isVerificationJobKind,
} from '../src/sms/relayLogic';
import { generateOtp } from '../src/auth/otpLogic';
import * as otpLogic from '../src/auth/otpLogic';
import { sanitiseTargetId } from '../src/lib/auditLog';

const PEPPER = 'p'.repeat(40);
const L = DEFAULT_LIMITS;

describe('config gates (fail closed)', () => {
  it('env gate requires the exact string "true"', () => {
    expect(phoneLinkEnvEnabled({ PHONE_LINK_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(true);
    for (const v of ['TRUE', '1', 'yes', '', undefined]) {
      expect(phoneLinkEnvEnabled({ PHONE_LINK_ENABLED: v } as NodeJS.ProcessEnv)).toBe(false);
    }
  });
  it('missing doc → disabled and stopped', () => {
    const c = resolvePhoneLinkConfig(true, null);
    expect(c.enabled).toBe(false);
    expect(c.emergencyStop).toBe(true);
    expect(phoneLinkSendingAllowed(c)).toBe(false);
  });
  it('emergencyStop must be explicitly false to send', () => {
    const base = { enabled: true, businessId: 'b', link: { enabled: true } };
    expect(resolvePhoneLinkConfig(true, base).emergencyStop).toBe(true);
    expect(resolvePhoneLinkConfig(true, { ...base, emergencyStop: 'false' }).emergencyStop).toBe(true);
    const ok = resolvePhoneLinkConfig(true, { ...base, emergencyStop: false });
    expect(phoneLinkSendingAllowed(ok)).toBe(true);
  });
  it('the link purpose must be switched on separately from the master switch', () => {
    expect(resolvePhoneLinkConfig(true, { enabled: true, emergencyStop: false, businessId: 'b' }).enabled).toBe(false);
    expect(resolvePhoneLinkConfig(true, { enabled: true, emergencyStop: false, businessId: 'b', signin: { enabled: true } }).enabled).toBe(false);
  });
  it('doc cannot enable the feature without the env gate', () => {
    expect(resolvePhoneLinkConfig(false, { enabled: true, businessId: 'b', emergencyStop: false, link: { enabled: true } }).enabled).toBe(false);
  });
  it('limits are clamped into hard bounds; garbage falls back to defaults', () => {
    const l = resolveLimits({ accountPerHour: 1e9, accountCooldownSec: 0, globalPerDay: -5, codeTtlSec: 'x' } as never);
    expect(l.accountPerHour).toBe(LIMIT_BOUNDS.accountPerHour[1]);
    expect(l.accountCooldownSec).toBe(LIMIT_BOUNDS.accountCooldownSec[0]);
    expect(l.globalPerDay).toBe(0);
    expect(l.codeTtlSec).toBe(DEFAULT_LIMITS.codeTtlSec);
    for (const [k, [lo, hi]] of Object.entries(LIMIT_BOUNDS)) {
      const d = DEFAULT_LIMITS[k as keyof typeof DEFAULT_LIMITS];
      expect(d >= lo && d <= hi, k).toBe(true);
    }
  });
});

describe('fixed windows', () => {
  const t = 1_000_000_000;
  it('counts within the window and resets after it', () => {
    let w = bumpWindow(undefined, t, HOUR_MS);
    w = bumpWindow(w, t + 1000, HOUR_MS);
    expect(windowCount(w, t + 2000, HOUR_MS)).toBe(2);
    expect(windowCount(w, t + HOUR_MS, HOUR_MS)).toBe(0);
    expect(bumpWindow(w, t + HOUR_MS, HOUR_MS)).toEqual({ s: t + HOUR_MS, c: 1 });
  });
  it('REGRESSION: an out-of-order (earlier) timestamp counts into the window, never resets it', () => {
    const w = { s: t, c: 3 };
    expect(windowCount(w, t - 50, HOUR_MS)).toBe(3);
    expect(bumpWindow(w, t - 50, HOUR_MS)).toEqual({ s: t, c: 4 });
    expect(distinctAllows({ s: t, k: ['a', 'b'] }, 'c', t - 50, DAY_MS, 2)).toBe(false);
  });
  it('distinct-number sets', () => {
    let s = addDistinct(undefined, 'a', t, DAY_MS);
    s = addDistinct(s, 'b', t, DAY_MS);
    expect(distinctAllows(s, 'a', t, DAY_MS, 2)).toBe(true);   // already counted
    expect(distinctAllows(s, 'c', t, DAY_MS, 2)).toBe(false);
    expect(distinctAllows(s, 'c', t + DAY_MS, DAY_MS, 2)).toBe(true);
    expect(distinctAllows(undefined, 'x', t, DAY_MS, 0)).toBe(false); // limit 0 = blocked
  });
});

describe('account / destination / source / global checks', () => {
  const t = 2_000_000_000;
  it('account: cooldown → hour → day → distinct numbers', () => {
    let a = applyAccount({}, 'n1', t);
    expect(checkAccount(a, 'n1', t + 1000, L)).toMatchObject({ code: 'cooldown', scope: 'account' });
    a = applyAccount(a, 'n1', t + 61_000);
    a = applyAccount(a, 'n2', t + 122_000);
    expect(checkAccount(a, 'n1', t + 183_000, L)).toMatchObject({ code: 'rate-limited' });
    const fresh = applyAccount(applyAccount({}, 'n1', t), 'n2', t + 61_000);
    expect(checkAccount(fresh, 'n3', t + 122_000, L)).toMatchObject({ code: 'too-many-numbers' });
    expect(checkAccount(fresh, 'n2', t + 122_000, L)).toBeNull();
  });
  it('account lastAt never moves backwards', () => {
    const a = applyAccount({ lastAt: t }, 'n1', t - 5000);
    expect(a.lastAt).toBe(t);
  });
  it('destination: cooldown then hourly cap', () => {
    let d = applyDestination({}, t);
    expect(checkDestination(d, t + 1000, L)?.code).toBe('cooldown');
    d = applyDestination(applyDestination(d, t + 61_000), t + 122_000);
    expect(checkDestination(d, t + 183_000, L)?.code).toBe('rate-limited');
  });
  it('source/global windows map to service-busy', () => {
    let w = {};
    for (let i = 0; i < 3; i++) w = applyWindows(w, t + i);
    expect(checkWindows(w, t + 10, 3, 100, 'global')).toMatchObject({ code: 'service-busy', scope: 'global' });
    expect(checkWindows(w, t + 10, 4, 100, 'source')).toBeNull();
  });
  it('verify-failure cap per account per day', () => {
    let a = {};
    for (let i = 0; i < L.accountVerifyFailuresPerDay; i++) a = applyVerifyFailure(a, t + i);
    expect(verifyFailuresExhausted(a, t + 100, L)).toBe(true);
    expect(verifyFailuresExhausted(a, t + DAY_MS + 100, L)).toBe(false);
  });
});

describe('request source (X-Forwarded-For)', () => {
  it('uses the right-most hop, ignoring client-supplied prefixes', () => {
    expect(trustedClientIp('1.1.1.1, 203.0.113.9', undefined)).toBe('203.0.113.9');
    expect(trustedClientIp('spoof, 10.0.0.1, 203.0.113.9', undefined)).toBe('203.0.113.9');
    expect(trustedClientIp('203.0.113.9, 35.191.0.1', undefined, 2)).toBe('203.0.113.9');
    expect(trustedClientIp(['1.1.1.1', '203.0.113.9'], undefined)).toBe('203.0.113.9');
  });
  it('a garbage hop yields no IP (shared unknown bucket), socket IP only without XFF', () => {
    expect(trustedClientIp('1.1.1.1, not-an-ip', '9.9.9.9')).toBeNull();
    expect(trustedClientIp(undefined, '9.9.9.9')).toBe('9.9.9.9');
    expect(trustedClientIp('', '::1')).toBe('::1');
    expect(sourceBucket(null)).toBe(UNKNOWN_SOURCE);
  });
  it('IPv6 buckets by /64; IPv4-mapped IPv6 buckets as IPv4', () => {
    expect(sourceBucket('2001:db8:1:2::1')).toBe(sourceBucket('2001:db8:1:2:ffff:eeee:dddd:cccc'));
    expect(sourceBucket('2001:db8:1:2::1')).not.toBe(sourceBucket('2001:db8:1:3::1'));
    expect(sourceBucket('::ffff:198.51.100.4')).toBe('v4:198.51.100.4');
    expect(sourceBucket('198.51.100.4')).toBe('v4:198.51.100.4');
    expect(trustedClientIp('198.51.100.4:5555', undefined)).toBe('198.51.100.4');
    expect(trustedClientIp('[2001:db8::1]:443', undefined)).toBe('2001:db8::1');
  });
});

describe('keyed hashing and code binding', () => {
  const b = { challengeId: 'c'.repeat(32), uid: 'u1', purpose: 'link' as const, phoneKey: phoneHmac(PEPPER, '+970599123456') };
  it('pepper must be present and long enough', () => {
    expect(() => assertPepper(undefined)).toThrow();
    expect(() => assertPepper('short')).toThrow();
    expect(assertPepper(PEPPER)).toBe(PEPPER);
  });
  it('phone/source keys are keyed and stable', () => {
    expect(phoneHmac(PEPPER, '+970599123456')).toMatch(/^[0-9a-f]{64}$/);
    expect(phoneHmac(PEPPER, '+970599123456')).toBe(b.phoneKey);
    expect(phoneHmac('q'.repeat(40), '+970599123456')).not.toBe(b.phoneKey);
    expect(phoneHmac(PEPPER, '+970599123456')).not.toContain('599123456');
    expect(sourceHmac(PEPPER, 'v4:1.2.3.4')).toHaveLength(32);
    expect(auditTag(b.phoneKey)).toHaveLength(16);
  });
  it('a verifier only matches its own challenge, user, purpose and number', () => {
    const v = codeVerifier(PEPPER, b, '123456');
    expect(verifyCode(PEPPER, b, '123456', v)).toBe(true);
    expect(verifyCode(PEPPER, b, '123457', v)).toBe(false);
    expect(verifyCode(PEPPER, { ...b, uid: 'u2' }, '123456', v)).toBe(false);
    expect(verifyCode(PEPPER, { ...b, challengeId: 'd'.repeat(32) }, '123456', v)).toBe(false);
    expect(verifyCode(PEPPER, { ...b, phoneKey: phoneHmac(PEPPER, '+970599123457') }, '123456', v)).toBe(false);
    expect(verifyCode(PEPPER, { ...b, purpose: 'signin' as never }, '123456', v)).toBe(false);
    expect(verifyCode(PEPPER, b, '123456', 'not-hex')).toBe(false);
  });
  it('codes and challenge ids come from the CSPRNG with the right shape', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = generateCode();
      expect(c).toMatch(/^\d{6}$/);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(190);
    expect(newChallengeId()).toMatch(/^[0-9a-f]{32}$/);
    expect(generateOtp()).toMatch(/^\d{6}$/);
  });
  it('masking shows only the country prefix and the last 3 digits', () => {
    expect(maskPhone('+970599123456')).toBe('+970••••••456');
  });
});

describe('caller freshness and profile state', () => {
  const now = 1_800_000_000_000;
  it('auth_time must be recent and after any revocation', () => {
    expect(authFreshness(now / 1000 - 60, now, 600)).toBe('ok');
    expect(authFreshness(now / 1000 - 601, now, 600)).toBe('reauth-required');
    expect(authFreshness(undefined, now, 600)).toBe('reauth-required');
    expect(authFreshness('123', now, 600)).toBe('reauth-required');
    expect(authFreshness(now / 1000 - 60, now, 600, new Date(now - 30_000).toUTCString())).toBe('reauth-required');
    expect(authFreshness(now / 1000 - 60, now, 600, new Date(now - 120_000).toUTCString())).toBe('ok');
  });
  it('profile must exist and be active (legacy docs without status count as active)', () => {
    expect(profileIsActive(true, 'active')).toBe(true);
    expect(profileIsActive(true, undefined)).toBe(true);
    expect(profileIsActive(true, 'suspended')).toBe(false);
    expect(profileIsActive(true, 'deleted')).toBe(false);
    expect(profileIsActive(false, 'active')).toBe(false);
  });
});

describe('number normalization for linking', () => {
  it('normalizes formatting variants to one E.164', () => {
    expect(normalizeLinkNumber('+970 (599) 123-456')).toEqual({ e164: '+970599123456', countryCode: 'PS' });
    expect(normalizeLinkNumber('+970599123456')).toEqual({ e164: '+970599123456', countryCode: 'PS' });
  });
  it('rejects unsupported prefixes, national format, junk and oversize input', () => {
    for (const bad of ['+970521234567', '0599123456', '+14155550188', 'abc', '', '+'.padEnd(40, '9'), 5]) {
      expect(normalizeLinkNumber(bad)).toBeNull();
    }
  });
});

describe('relay: verification jobs never retry and are gated at claim', () => {
  it('failureOutcome/reapDecision never requeue verification kinds', () => {
    expect(failureOutcome(1, 5, 'transient', 'phone_link_otp')).toBe('fail');
    expect(failureOutcome(1, 5, 'transient', 'otp')).toBe('fail');
    expect(failureOutcome(1, 5, 'transient', 'sms')).toBe('requeue');
    const lapsed = { status: 'claimed' as const, leaseExpiresAtMs: 1, attempts: 1, maxAttempts: 5 };
    expect(reapDecision({ ...lapsed, kind: 'phone_link_otp' }, 10)).toBe('fail');
    expect(reapDecision(lapsed, 10)).toBe('requeue');
  });
  it('claim decision', () => {
    const now = 1000;
    expect(isVerificationJobKind('sms')).toBe(false);
    expect(verificationClaimDecision({ kind: 'sms', expiresAtMs: null }, now, false)).toBe('allow');
    expect(verificationClaimDecision({ kind: 'otp', expiresAtMs: now + 1 }, now, true)).toBe('cancel-public-otp-disabled');
    expect(verificationClaimDecision({ kind: 'phone_link_otp', expiresAtMs: null }, now, true)).toBe('cancel-expired');
    expect(verificationClaimDecision({ kind: 'phone_link_otp', expiresAtMs: now }, now, true)).toBe('cancel-expired');
    expect(verificationClaimDecision({ kind: 'phone_link_otp', expiresAtMs: now + 1 }, now, false)).toBe('cancel-sending-stopped');
    expect(verificationClaimDecision({ kind: 'phone_link_otp', expiresAtMs: now + 1 }, now, true)).toBe('allow');
  });
});

describe('retired public sign-in', () => {
  it('no fixed test credential remains exported', () => {
    expect((otpLogic as Record<string, unknown>).TEST_PHONE_E164).toBeUndefined();
    expect((otpLogic as Record<string, unknown>).TEST_PHONE_OTP).toBeUndefined();
    expect((otpLogic as Record<string, unknown>).isTestPhone).toBeUndefined();
  });
  it('audit target ids of type phone are redacted', () => {
    expect(sanitiseTargetId({ type: 'phone', id: '970599123456' })).toBe('+••••••••••56');
    expect(sanitiseTargetId({ type: 'phoneHash', id: 'abc' })).toBe('abc');
  });
});
