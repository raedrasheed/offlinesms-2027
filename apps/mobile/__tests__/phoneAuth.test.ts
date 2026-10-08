import { describe, it, expect } from 'vitest';
import { PhoneAuthFlow, phoneAuthErrorInfo, type PhoneAuthApi, type StartResult, type CodeResult } from '../src/lib/phoneAuth.flow';
import { stepForStatus } from '../src/lib/phoneLink.helpers';
import en from '../src/i18n/en.json';
import ar from '../src/i18n/ar.json';

const pow = (n: string) => ({ nonce: n, bits: 1, expiresAtMs: Date.now() + 60_000 });
const err = (message: string, code = 'functions/failed-precondition', details?: unknown) =>
  Object.assign(new Error(message), { code, details });

function api(over: Partial<PhoneAuthApi> = {}) {
  const calls = { start: 0, request: [] as Array<Record<string, string>>, verify: 0 };
  const a: PhoneAuthApi = {
    async start() { calls.start++; return { sessionToken: 'T'.repeat(43), expiresAtMs: Date.now() + 1_800_000, pow: pow('n' + calls.start) } as StartResult; },
    async request(p) { calls.request.push(p as never); return { challengeId: 'c'.repeat(32), expiresAtMs: 0, resendAfterSec: 60, maskedPhone: 'x', pow: pow('next') } as CodeResult; },
    async verify() { calls.verify++; return { customToken: 'tok', uid: 'u', isNewUser: true }; },
    ...over,
  };
  return { a, calls };
}
const solver = async (nonce: string) => `sol-${nonce}`;

describe('PhoneAuthFlow', () => {
  it('opens a session, solves the proof for the number, and keeps the fresh proof', async () => {
    const { a, calls } = api();
    const f = new PhoneAuthFlow(a, solver, 'inst');
    await f.sendCode('+970599123456');
    expect(calls.start).toBe(1);
    expect(calls.request[0]).toMatchObject({ powNonce: 'n1', powSolution: 'sol-n1', phoneE164: '+970599123456' });
    await f.sendCode('+970599123456');
    expect(calls.start).toBe(1);
    expect(calls.request[1]).toMatchObject({ powNonce: 'next' });
  });

  it('a lost response is retried with the SAME requestId (server dedups)', async () => {
    let n = 0;
    const { a, calls } = api({
      async request(p) {
        calls.request.push(p as never);
        if (n++ === 0) throw err('internal', 'functions/internal');
        return { challengeId: 'c'.repeat(32), expiresAtMs: 0, resendAfterSec: 60, maskedPhone: 'x', pow: pow('next') };
      },
    });
    await new PhoneAuthFlow(a, solver, null).sendCode('+970599123456');
    expect(calls.request).toHaveLength(2);
    expect(calls.request[0].requestId).toBe(calls.request[1].requestId);
  });

  it('a consumed/invalid proof is retried once with the fresh challenge; an expired session is renewed once', async () => {
    let n = 0;
    const { a, calls } = api({
      async request(p) {
        calls.request.push(p as never);
        n++;
        if (n === 1) throw err('proof-invalid', 'functions/permission-denied', { pow: pow('fresh') });
        if (n === 2) throw err('session-expired');
        return { challengeId: 'c'.repeat(32), expiresAtMs: 0, resendAfterSec: 60, maskedPhone: 'x', pow: pow('next') };
      },
    });
    await new PhoneAuthFlow(a, solver, null).sendCode('+970599123456');
    expect(calls.request.map(r => r.powNonce)).toEqual(['n1', 'fresh', 'n2']);
    expect(calls.start).toBe(2);
  });

  it('limits are surfaced, not retried', async () => {
    const { a, calls } = api({ async request(p) { calls.request.push(p as never); throw err('cooldown', 'functions/resource-exhausted', { retryAfterSec: 42, pow: pow('f') }); } });
    await expect(new PhoneAuthFlow(a, solver, null).sendCode('+970599123456')).rejects.toThrow('cooldown');
    expect(calls.request).toHaveLength(1);
  });
});

describe('phone sign-in error copy (AR/EN)', () => {
  const lookup = (d: any, k: string) => k.split('.').reduce((o, p) => o?.[p], d);
  it('every server code maps to copy that exists in both languages', () => {
    for (const c of ['phone-auth-unavailable', 'app-update-required', 'service-paused', 'service-busy', 'number-not-supported',
      'no-relay-for-country', 'session-expired', 'session-exhausted', 'cooldown', 'rate-limited', 'too-many-numbers',
      'code-invalid', 'code-expired', 'too-many-attempts', 'account-disabled', 'signin-interrupted', 'challenge-not-found', 'proof-invalid']) {
      const { key } = phoneAuthErrorInfo(err(c));
      expect(typeof lookup(en, key), `${c} en`).toBe('string');
      expect(typeof lookup(ar, key), `${c} ar`).toBe('string');
    }
    expect(phoneAuthErrorInfo(err('cooldown', 'functions/resource-exhausted', { retryAfterSec: 42 })).retryAfterSec).toBe(42);
    expect(phoneAuthErrorInfo(err('internal', 'functions/internal')).key).toBe('phoneAuth.errors.network');
  });
});

describe('K (R7) — link screen step after re-authentication', () => {
  it('a pending recovery always resumes, even while new sending is paused', () => {
    expect(stepForStatus({ available: true, pendingRecovery: true, sendingPaused: true, reauthRequired: true, eligible: true })).toBe('recover');
    expect(stepForStatus({ available: true, pendingRecovery: true, eligible: false })).toBe('recover');
  });
  it('otherwise number entry only when sending is allowed', () => {
    expect(stepForStatus({ available: true, eligible: true, sendingPaused: true })).toBe('unavailable');
    expect(stepForStatus({ available: true, eligible: true })).toBe('number');
    expect(stepForStatus({ available: true, eligible: true, reauthRequired: true })).toBe('reauth');
    expect(stepForStatus({ available: true, linked: true })).toBe('linked');
    expect(stepForStatus({ available: false })).toBe('unavailable');
  });
});
