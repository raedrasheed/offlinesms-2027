import { describe, it, expect } from 'vitest';
import {
  OTP_LIMIT_FIELDS, readOtpLimits, parseOtpLimits,
  RELAY_CAP_DEFAULTS, effectiveRelayCaps, parseRelayCaps,
} from '../lib/otpLimits';
import { DEFAULT_SIGNIN_LIMITS, SIGNIN_LIMIT_BOUNDS } from '../../../functions/src/phoneAuth/config';
import { DEFAULT_LIMITS as DEFAULT_LINK_LIMITS, LIMIT_BOUNDS as LINK_LIMIT_BOUNDS } from '../../../functions/src/phoneLink/config';
import { SHARED_DEFAULTS, SHARED_BOUNDS } from '../../../functions/src/verification/policy';

describe('OTP limit fields match the functions', () => {
  it('uses the same defaults and bounds the functions clamp to', () => {
    for (const f of OTP_LIMIT_FIELDS) {
      const [def, bounds] = f.group === 'signin'
        ? [DEFAULT_SIGNIN_LIMITS[f.name as keyof typeof DEFAULT_SIGNIN_LIMITS], SIGNIN_LIMIT_BOUNDS[f.name as keyof typeof SIGNIN_LIMIT_BOUNDS]]
        : f.group === 'link'
          ? [DEFAULT_LINK_LIMITS[f.name as keyof typeof DEFAULT_LINK_LIMITS], LINK_LIMIT_BOUNDS[f.name as keyof typeof LINK_LIMIT_BOUNDS]]
          : [SHARED_DEFAULTS[f.name as keyof typeof SHARED_DEFAULTS], SHARED_BOUNDS[f.name as keyof typeof SHARED_BOUNDS]];
      expect(bounds, f.path).toBeDefined();
      expect([f.def, f.min, f.max], f.path).toEqual([def, bounds[0], bounds[1]]);
      expect(f.path).toBe(f.group === 'shared' ? `shared.${f.name}` : `${f.group}.limits.${f.name}`);
    }
  });
});

describe('readOtpLimits', () => {
  it('reads stored numbers and reports missing ones as null', () => {
    const v = readOtpLimits({ signin: { limits: { globalPerHour: 5 } }, shared: { perDay: '10' } });
    expect(v['signin.limits.globalPerHour']).toBe(5);
    expect(v['signin.limits.globalPerDay']).toBeNull();
    expect(v['shared.perDay']).toBeNull();
    expect(readOtpLimits(null)['link.limits.accountPerHour']).toBeNull();
  });
});

describe('parseOtpLimits', () => {
  it('accepts whole numbers within bounds, including 0, and null to remove', () => {
    expect(parseOtpLimits({ 'signin.limits.globalPerHour': 5, 'shared.perHour': 0, 'link.limits.accountPerDay': null }))
      .toEqual({ values: { 'signin.limits.globalPerHour': 5, 'shared.perHour': 0, 'link.limits.accountPerDay': null } });
  });

  it('refuses unknown paths, so no other field of smsConfig/otp can be written', () => {
    for (const path of ['enabled', 'emergencyStop', 'businessId', 'policyVersion', 'signin.enabled', 'signin.limits.powBits', 'signin.attestation']) {
      expect(parseOtpLimits({ [path]: 1 }), path).toHaveProperty('error');
    }
  });

  it('refuses values outside the bounds, fractions and non-numbers', () => {
    for (const v of [-1, 11, 2.5, '3', true, Number.NaN]) {
      expect(parseOtpLimits({ 'signin.limits.destinationPerHour': v }), String(v)).toHaveProperty('error');
    }
    expect(parseOtpLimits({ 'signin.limits.globalPerHour': 2001 })).toHaveProperty('error');
  });

  it('refuses an empty or malformed edit', () => {
    expect(parseOtpLimits({})).toHaveProperty('error');
    expect(parseOtpLimits(null)).toHaveProperty('error');
    expect(parseOtpLimits([1])).toHaveProperty('error');
  });
});

describe('relay caps', () => {
  it('fills missing caps with the functions defaults', () => {
    expect(effectiveRelayCaps(undefined)).toEqual(RELAY_CAP_DEFAULTS);
    expect(effectiveRelayCaps({ maxPerMinute: 1 })).toEqual({ ...RELAY_CAP_DEFAULTS, maxPerMinute: 1 });
  });

  it('accepts small rollout caps and 0 (device sends nothing)', () => {
    expect(parseRelayCaps({ maxPerMinute: 1, maxPerHour: 5, maxPerDay: 10 })).toEqual({ caps: { maxPerMinute: 1, maxPerHour: 5, maxPerDay: 10 } });
    expect(parseRelayCaps({ maxPerMinute: 0, maxPerHour: 0, maxPerDay: 0 })).toHaveProperty('caps');
  });

  it('refuses missing, fractional, out-of-bound or decreasing caps', () => {
    expect(parseRelayCaps({ maxPerMinute: 1, maxPerHour: 5 })).toHaveProperty('error');
    expect(parseRelayCaps({ maxPerMinute: 1.5, maxPerHour: 5, maxPerDay: 10 })).toHaveProperty('error');
    expect(parseRelayCaps({ maxPerMinute: 16, maxPerHour: 100, maxPerDay: 500 })).toHaveProperty('error');
    expect(parseRelayCaps({ maxPerMinute: 6, maxPerHour: 5, maxPerDay: 10 })).toHaveProperty('error');
    expect(parseRelayCaps({ maxPerMinute: 1, maxPerHour: 50, maxPerDay: 10 })).toHaveProperty('error');
  });
});
