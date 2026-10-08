// Second-round review (N1–N5) — pure guards behind the handler fixes.

import { describe, it, expect } from 'vitest';
import { withinCompletionWindow, reviewGeneration, isDemoReviewAccount } from '../src/phoneAuth/verifyPhoneAuthCode';
import { deviceRoutingAllows } from '../src/sms/relayJobs';
import { classifyFailure, failureOutcome } from '../src/sms/relayLogic';

describe('N1 — completion window from server acceptance', () => {
  const t0 = 1_000_000;
  it('allows retries inside the window, refuses after it', () => {
    expect(withinCompletionWindow(t0, t0, 60)).toBe(true);
    expect(withinCompletionWindow(t0, t0 + 59_999, 60)).toBe(true);
    expect(withinCompletionWindow(t0, t0 + 60_000, 60)).toBe(false);
  });
  it('fails closed on a missing/garbled acceptance time or one far in the future', () => {
    expect(withinCompletionWindow(undefined, t0, 60)).toBe(false);
    expect(withinCompletionWindow('1000', t0, 60)).toBe(false);
    expect(withinCompletionWindow(Number.NaN, t0, 60)).toBe(false);
    expect(withinCompletionWindow(t0 + 10_000, t0, 60)).toBe(false);
  });
});

describe('N1 — review-access generation', () => {
  const base = { phoneE164: '+970599100001', uid: 'demo', codeSalt: 's', codeHash: 'h', expiresAtMs: 5 };
  it('is stable for the same config and changes on any rotation', () => {
    expect(reviewGeneration(base)).toBe(reviewGeneration({ ...base }));
    for (const k of Object.keys(base) as Array<keyof typeof base>) {
      const changed = { ...base, [k]: typeof base[k] === 'number' ? 6 : `${base[k]}x` };
      expect(reviewGeneration(changed)).not.toBe(reviewGeneration(base));
    }
  });
});

describe('N2 — designated demo review account', () => {
  it('only exactly { demoReview: true } on an enabled account', () => {
    expect(isDemoReviewAccount({ customClaims: { demoReview: true } })).toBe(true);
    expect(isDemoReviewAccount({ customClaims: { demoReview: true }, disabled: true })).toBe(false);
    expect(isDemoReviewAccount({ customClaims: { demoReview: true, admin: true } })).toBe(false);
    expect(isDemoReviewAccount({ customClaims: { demoReview: 'true' } })).toBe(false);
    expect(isDemoReviewAccount({ customClaims: {} })).toBe(false);
    expect(isDemoReviewAccount({ customClaims: null })).toBe(false);
  });
});

describe('N3 — device routing at claim and at authorization', () => {
  it('a tagged job needs routing ON and its country in the allow-list', () => {
    expect(deviceRoutingAllows({ countryRoutingEnabled: true, allowedCountryCodes: ['PS'] }, 'PS')).toBe(true);
    expect(deviceRoutingAllows({ countryRoutingEnabled: false, allowedCountryCodes: ['PS'] }, 'PS')).toBe(false);
    expect(deviceRoutingAllows({ countryRoutingEnabled: true, allowedCountryCodes: ['JO'] }, 'PS')).toBe(false);
    expect(deviceRoutingAllows({ countryRoutingEnabled: true }, 'PS')).toBe(false);
  });
});

describe('N5 — ambiguous hand-offs are never retried', () => {
  it('ambiguous-handoff is a permanent failure', () => {
    expect(classifyFailure(null, 'ambiguous-handoff')).toBe('permanent');
    expect(failureOutcome(1, 5, classifyFailure(null, 'ambiguous-handoff'), 'business')).toBe('fail');
  });
});
