import { describe, it, expect } from 'vitest';
import { phoneLinkErrorInfo, toE164, formatCountdown } from '../src/lib/phoneLink.helpers';
import en from '../src/i18n/en.json';
import ar from '../src/i18n/ar.json';

const SERVER_CODES = [
  'auth-required', 'reauth-required', 'email-not-verified', 'email-account-required', 'account-disabled',
  'not-allowed', 'phone-link-disabled', 'service-paused', 'service-busy', 'consent-required',
  'number-not-supported', 'no-relay-for-country', 'phone-unavailable', 'already-linked',
  'link-pending-recovery', 'link-interrupted', 'cooldown', 'rate-limited', 'too-many-numbers',
  'code-invalid', 'code-expired', 'too-many-attempts', 'challenge-not-found', 'purpose-invalid',
];

function lookup(dict: any, key: string): unknown {
  return key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict);
}

describe('phone-link error copy', () => {
  it('every server code maps to a key that exists in English AND Arabic', () => {
    for (const code of SERVER_CODES) {
      const { key } = phoneLinkErrorInfo({ message: code, code: 'functions/failed-precondition' });
      // A tampered purpose only comes from a modified client: generic copy.
      if (code !== 'purpose-invalid') expect(key, code).not.toBe('phoneLink.errors.generic');
      expect(typeof lookup(en, key), `${code} en`).toBe('string');
      expect(typeof lookup(ar, key), `${code} ar`).toBe('string');
    }
  });
  it('carries retry/attempt details and recovery hints', () => {
    expect(phoneLinkErrorInfo({ message: 'cooldown', details: { retryAfterSec: 42 } }).retryAfterSec).toBe(42);
    expect(phoneLinkErrorInfo({ message: 'code-invalid', details: { attemptsLeft: 3 } }).attemptsLeft).toBe(3);
    expect(phoneLinkErrorInfo({ message: 'reauth-required' }).needsReauth).toBe(true);
    expect(phoneLinkErrorInfo({ message: 'link-interrupted' }).canResume).toBe(true);
  });
  it('never surfaces raw / unknown server text', () => {
    expect(phoneLinkErrorInfo({ message: 'Error: internal stack at foo.ts:12' }).key).toBe('phoneLink.errors.generic');
    expect(phoneLinkErrorInfo({ message: 'x', code: 'functions/unavailable' }).key).toBe('phoneLink.errors.network');
    expect(phoneLinkErrorInfo(null).key).toBe('phoneLink.errors.generic');
  });
});

describe('phone input helpers', () => {
  it('builds E.164 from dial code + local digits, stripping trunk 0 and spacing', () => {
    expect(toE164('+970', '0599 123 456')).toBe('+970599123456');
    expect(toE164('+972', '59-912-3456')).toBe('+972599123456');
  });
  it('formats countdowns', () => {
    expect(formatCountdown(61)).toBe('1:01');
    expect(formatCountdown(0)).toBe('0:00');
  });
});
