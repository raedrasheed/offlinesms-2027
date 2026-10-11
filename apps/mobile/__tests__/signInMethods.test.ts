import { describe, expect, it } from 'vitest';
import {
  emailChangeErrorInfo, signInMethodRows, isPlausibleEmail, formatOwnPhone,
} from '../src/lib/signInMethods.helpers';
import { stepForStatus } from '../src/lib/phoneLink.helpers';
import en from '../src/i18n/en.json';
import ar from '../src/i18n/ar.json';

const get = (o: unknown, path: string) => path.split('.').reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o);

describe('Settings sign-in method rows', () => {
  it('email-registered account: Email = Edit, Phone = Add', () => {
    expect(signInMethodRows({ email: 'a@b.co', phone: null }, {})).toEqual([
      { kind: 'email', value: 'a@b.co', action: 'edit' },
      { kind: 'phone', value: null, action: 'add' },
    ]);
  });
  it('phone-registered account: Email = Add, Phone = Edit', () => {
    expect(signInMethodRows({ email: null, phone: '+970599100001' }, {}).map(r => r.action)).toEqual(['add', 'edit']);
  });
  it('both present: both Edit; server view wins over the local Auth user', () => {
    expect(signInMethodRows({ email: 'n@b.co', phone: '+970599100001' }, { email: 'old@b.co', phoneNumber: null }))
      .toEqual([{ kind: 'email', value: 'n@b.co', action: 'edit' }, { kind: 'phone', value: '+970599100001', action: 'edit' }]);
  });
  it('server unknown (offline): falls back to the local Auth user, still shows both rows', () => {
    expect(signInMethodRows(null, { email: 'a@b.co' }).map(r => [r.kind, r.action])).toEqual([['email', 'edit'], ['phone', 'add']]);
  });
});

describe('email change error mapping', () => {
  const codes = [
    'auth-required', 'reauth-required', 'email-not-verified', 'account-disabled', 'email-change-disabled', 'email-invalid',
    'email-send-failed', 'email-unavailable', 'already-linked', 'change-pending-recovery', 'change-interrupted', 'cooldown',
    'rate-limited', 'too-many-numbers', 'code-invalid', 'code-expired', 'too-many-attempts', 'challenge-not-found',
    'otp-cooldown', 'otp-incorrect', 'otp-expired', 'otp-too-many-attempts', 'otp-rate-limited', 'otp-not-requested',
  ];
  it('every server code maps to copy that exists in English and Arabic', () => {
    for (const c of codes) {
      const k = emailChangeErrorInfo({ message: c }).key;
      expect(k, c).not.toBe('emailChange.errors.generic');
      expect(typeof get(en, k), `${c} en`).toBe('string');
      expect(typeof get(ar, k), `${c} ar`).toBe('string');
    }
  });
  it('raw / unknown text never leaks; network errors get network copy', () => {
    expect(emailChangeErrorInfo({ message: 'Firebase: internal stack' }).key).toBe('emailChange.errors.generic');
    expect(emailChangeErrorInfo({ code: 'functions/unavailable', message: 'x' }).key).toBe('emailChange.errors.network');
  });
  it('flags reauth and resume, and carries retry/attempt details', () => {
    expect(emailChangeErrorInfo({ message: 'reauth-required' }).needsReauth).toBe(true);
    expect(emailChangeErrorInfo({ message: 'change-interrupted' }).canResume).toBe(true);
    expect(emailChangeErrorInfo({ message: 'code-invalid', details: { attemptsLeft: 3 } }).attemptsLeft).toBe(3);
    expect(emailChangeErrorInfo({ message: 'cooldown', details: { retryAfterSec: 40 } }).retryAfterSec).toBe(40);
  });
});

describe('phone link step in change mode', () => {
  const linked = { available: true, linked: true, eligible: true, sendingPaused: false, reauthRequired: true };
  it('a linked account shows "linked" normally, but goes to re-auth when changing', () => {
    expect(stepForStatus(linked)).toBe('linked');
    expect(stepForStatus(linked, { change: true })).toBe('reauth');
    expect(stepForStatus({ ...linked, reauthRequired: false }, { change: true })).toBe('number');
  });
  it('recovery still wins over a change', () => {
    expect(stepForStatus({ ...linked, pendingRecovery: true }, { change: true })).toBe('recover');
  });
});

describe('small formatters', () => {
  it('email plausibility', () => {
    expect(isPlausibleEmail(' a@b.co ')).toBe(true);
    expect(isPlausibleEmail('a@b')).toBe(false);
  });
  it('own phone display', () => {
    expect(formatOwnPhone('+970599123456')).toBe('+970 599 123 456');
    expect(formatOwnPhone(null)).toBe('');
  });
});
