// Shared verification policy, sign-in config, proof-of-work, review access and
// relay capacity reservations — pure logic.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  resolveShared, purposeSendingAllowed, verificationJobStillValid, purposeEnvEnabled,
} from '../src/verification/policy';
import { resolvePhoneAuthConfig, resolveReviewAccess, DEFAULT_SIGNIN_LIMITS, SIGNIN_LIMIT_BOUNDS } from '../src/phoneAuth/config';
import { verifyPow, solvePow, leadingZeroBits, adaptiveBits, newPowNonce } from '../src/phoneAuth/pow';
import { reviewCodeMatches } from '../src/phoneAuth/verifyPhoneAuthCode';
import {
  relayCapacityCheck, reserveRelayUsage, sanitizeTelemetryCount, utcDayKey, verificationPurposeOf,
  isVerificationJobKind, failureOutcome, reapDecision, generatePairingCode,
} from '../src/sms/relayLogic';

const ENV = { PHONE_AUTH_ENABLED: 'true', PHONE_LINK_ENABLED: 'true' } as NodeJS.ProcessEnv;
const ON = { enabled: true, emergencyStop: false, businessId: 'org', policyVersion: 3, signin: { enabled: true }, link: { enabled: true } };

describe('shared verification policy (smsConfig/otp)', () => {
  it("today's production doc (businessId only) is OFF and STOPPED", () => {
    const s = resolveShared({ businessId: 'org', androidAppHash: 'abcdefghijk' });
    expect(s).toMatchObject({ masterEnabled: false, emergencyStop: true, businessId: 'org' });
    expect(purposeSendingAllowed('signin', { businessId: 'org' }, ENV)).toBe(false);
    expect(purposeSendingAllowed('link', null, ENV)).toBe(false);
  });
  it('every switch is required: env, master, stop=false, sender, purpose', () => {
    expect(purposeSendingAllowed('signin', ON, ENV)).toBe(true);
    expect(purposeSendingAllowed('signin', ON, {} as NodeJS.ProcessEnv)).toBe(false);
    expect(purposeSendingAllowed('signin', { ...ON, enabled: false }, ENV)).toBe(false);
    expect(purposeSendingAllowed('signin', { ...ON, emergencyStop: true }, ENV)).toBe(false);
    expect(purposeSendingAllowed('signin', { ...ON, businessId: null }, ENV)).toBe(false);
    expect(purposeSendingAllowed('signin', { ...ON, signin: { enabled: false } }, ENV)).toBe(false);
    expect(purposeSendingAllowed('link', { ...ON, link: {} }, ENV)).toBe(false);
    expect(purposeEnvEnabled('signin', { PHONE_AUTH_ENABLED: 'TRUE' } as NodeJS.ProcessEnv)).toBe(false);
  });
  it('queued/claimed jobs are bound to sender + policy generation + expiry', () => {
    const job = { purpose: 'signin' as const, businessId: 'org', policyVersion: 3, expiresAtMs: 2000 };
    expect(verificationJobStillValid(job, ON, 1000, ENV)).toBe('ok');
    expect(verificationJobStillValid(job, ON, 2000, ENV)).toBe('expired');
    expect(verificationJobStillValid({ ...job, expiresAtMs: null }, ON, 1000, ENV)).toBe('expired');
    expect(verificationJobStillValid(job, { ...ON, policyVersion: 4 }, 1000, ENV)).toBe('policy-changed');
    expect(verificationJobStillValid(job, { ...ON, businessId: 'other' }, 1000, ENV)).toBe('policy-changed');
    expect(verificationJobStillValid(job, { ...ON, emergencyStop: true }, 1000, ENV)).toBe('sending-stopped');
    expect(verificationJobStillValid({ ...job, purpose: null }, ON, 1000, ENV)).toBe('sending-stopped');
  });
});

describe('sign-in config', () => {
  it('defaults are inside their bounds; overrides are clamped', () => {
    for (const [k, [lo, hi]] of Object.entries(SIGNIN_LIMIT_BOUNDS)) {
      const v = DEFAULT_SIGNIN_LIMITS[k as keyof typeof DEFAULT_SIGNIN_LIMITS];
      expect(v >= lo && v <= hi, k).toBe(true);
    }
    const c = resolvePhoneAuthConfig(true, { ...ON, signin: { enabled: true, limits: { powBits: 2, sessionMaxCodes: 1e6, globalPerDay: 'x' } } });
    expect(c.limits.powBits).toBe(8);
    expect(c.limits.sessionMaxCodes).toBe(10);
    expect(c.limits.globalPerDay).toBe(DEFAULT_SIGNIN_LIMITS.globalPerDay);
    expect(c.attestation).toBe('off');
    expect(resolvePhoneAuthConfig(true, { ...ON, signin: { enabled: true, attestation: 'required' } }).attestation).toBe('required');
  });
});

describe('proof-of-work', () => {
  it('verifies only a real solution for the same nonce and number', () => {
    const nonce = newPowNonce();
    const sol = solvePow(nonce, '+970599123456', 10)!;
    expect(verifyPow(nonce, '+970599123456', sol, 10)).toBe(true);
    const other = newPowNonce();
    const expectOther = leadingZeroBits(createHash('sha256').update(`pow:v1:${other}:+970599123456:${sol}`).digest()) >= 10;
    expect(verifyPow(other, '+970599123456', sol, 10)).toBe(expectOther); // a proof is only valid for its own nonce
    expect(verifyPow(nonce, '+970599123457', sol, 10)).toBe(
      leadingZeroBits(createHash('sha256').update(`pow:v1:${nonce}:+970599123457:${sol}`).digest()) >= 10);
    expect(verifyPow(nonce, '+970599123456', 'abc', 10)).toBe(false);
    expect(verifyPow(nonce, '+970599123456', '1'.repeat(17), 0)).toBe(false);
    expect(verifyPow(nonce, '+970599123456', undefined, 0)).toBe(false);
  });
  it('adaptive difficulty rises with load and is capped', () => {
    expect(adaptiveBits(16, 20, 0, 100)).toBe(16);
    expect(adaptiveBits(16, 20, 50, 100)).toBe(18);
    expect(adaptiveBits(16, 20, 95, 100)).toBe(20);
    expect(adaptiveBits(16, 18, 95, 100)).toBe(18);
  });
});

describe('store-review access', () => {
  const salt = 'a'.repeat(32);
  const hash = createHash('sha256').update(`${salt}:246810`).digest('hex');
  const base = { enabled: true, phoneE164: '+970599000001', codeSalt: salt, codeHash: hash, uid: 'demo' };
  it('only valid, enabled, time-boxed (≤30 days) config is honoured', () => {
    const now = 1_000_000;
    expect(resolveReviewAccess({ ...base, expiresAtMs: now + 1000 }, now)).not.toBeNull();
    expect(resolveReviewAccess({ ...base, expiresAtMs: now - 1 }, now)).toBeNull();
    expect(resolveReviewAccess({ ...base, expiresAtMs: now + 31 * 86_400_000 }, now)).toBeNull();
    expect(resolveReviewAccess({ ...base, enabled: false, expiresAtMs: now + 1000 }, now)).toBeNull();
    expect(resolveReviewAccess({ ...base, codeHash: 'zz', expiresAtMs: now + 1000 }, now)).toBeNull();
    expect(resolveReviewAccess(undefined, now)).toBeNull();
  });
  it('code check is exact', () => {
    const r = { ...base, expiresAtMs: 0 };
    expect(reviewCodeMatches(r, '246810')).toBe(true);
    expect(reviewCodeMatches(r, '246811')).toBe(false);
  });
});

describe('relay capacity reservations', () => {
  const caps = { maxPerMinute: 2, maxPerHour: 3, maxPerDay: 4 };
  it('minute → hour → day windows, server-owned', () => {
    const t = Date.UTC(2026, 9, 8, 12, 0, 0);
    let u = reserveRelayUsage(undefined, t);
    u = reserveRelayUsage(u, t + 1);
    expect(relayCapacityCheck(caps, u, t + 2)).toEqual({ ok: false, window: 'minute' });
    expect(relayCapacityCheck(caps, u, t + 61_000)).toEqual({ ok: true });
    u = reserveRelayUsage(u, t + 61_000);
    expect(relayCapacityCheck(caps, u, t + 122_000)).toEqual({ ok: false, window: 'hour' });
    expect(relayCapacityCheck({ ...caps, maxPerHour: 100 }, { ...u, d: { key: utcDayKey(new Date(t)), c: 4 } }, t + 122_000)).toEqual({ ok: false, window: 'day' });
  });
  it('UTC day rollover resets only the day window', () => {
    const late = Date.UTC(2026, 9, 8, 23, 59, 59);
    const u = { d: { key: utcDayKey(new Date(late)), c: 4 } };
    expect(relayCapacityCheck(caps, u, late)).toEqual({ ok: false, window: 'day' });
    expect(relayCapacityCheck(caps, u, late + 2000)).toEqual({ ok: true });
    expect(reserveRelayUsage(u, late + 2000).d).toEqual({ key: utcDayKey(new Date(late + 2000)), c: 1 });
  });
  it('defaults apply when caps are missing (legacy devices)', () => {
    let u = {};
    for (let i = 0; i < 6; i++) u = reserveRelayUsage(u, 1000 + i);
    expect(relayCapacityCheck(undefined, u, 1010)).toEqual({ ok: false, window: 'minute' });
  });
  it('heartbeat telemetry is clamped and never trusted as a counter', () => {
    expect(sanitizeTelemetryCount(-3)).toBe(0);
    expect(sanitizeTelemetryCount(1e12)).toBe(1_000_000);
    expect(sanitizeTelemetryCount('5')).toBeNull();
    expect(sanitizeTelemetryCount(Number.NaN)).toBeNull();
  });
  it('sign-in jobs are verification jobs: never retried', () => {
    expect(isVerificationJobKind('phone_auth_otp')).toBe(true);
    expect(verificationPurposeOf('phone_auth_otp')).toBe('signin');
    expect(verificationPurposeOf('phone_link_otp')).toBe('link');
    expect(verificationPurposeOf('otp')).toBeNull();
    expect(failureOutcome(1, 9, 'transient', 'phone_auth_otp')).toBe('fail');
    expect(reapDecision({ status: 'sending', leaseExpiresAtMs: 1, attempts: 1, maxAttempts: 9, kind: 'phone_auth_otp' }, 5)).toBe('fail');
  });
  it('pairing codes come from the CSPRNG alphabet', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generatePairingCode()));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  });
});
