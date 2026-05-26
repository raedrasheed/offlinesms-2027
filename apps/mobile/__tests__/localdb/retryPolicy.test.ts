import { describe, it, expect } from 'vitest';
import { backoffMs, nextAttemptAt, isPermanent, errorCode } from '../../src/localdb/sync/retryPolicy';

describe('backoffMs', () => {
  it('grows exponentially without jitter', () => {
    expect(backoffMs(1, false)).toBe(2000);
    expect(backoffMs(2, false)).toBe(4000);
    expect(backoffMs(3, false)).toBe(8000);
  });
  it('caps at 5 minutes', () => {
    expect(backoffMs(20, false)).toBe(5 * 60 * 1000);
  });
  it('with jitter stays within [exp/2, exp]', () => {
    const exp = backoffMs(4, false);
    const j = backoffMs(4, true, () => 0.5);
    expect(j).toBeGreaterThanOrEqual(exp / 2);
    expect(j).toBeLessThanOrEqual(exp);
  });
});

describe('nextAttemptAt', () => {
  it('is in the future', () => {
    const now = 1_000_000;
    expect(nextAttemptAt(1, now, () => 0)).toBeGreaterThan(now);
  });
});

describe('error classification', () => {
  it('strips the functions/ prefix', () => {
    expect(errorCode({ code: 'functions/permission-denied' })).toBe('permission-denied');
    expect(errorCode({ code: 'unavailable' })).toBe('unavailable');
  });
  it('flags permanent errors', () => {
    expect(isPermanent({ code: 'functions/invalid-argument' })).toBe(true);
    expect(isPermanent({ code: 'functions/permission-denied' })).toBe(true);
    expect(isPermanent({ code: 'functions/not-found' })).toBe(true);
  });
  it('treats transient errors as retryable', () => {
    expect(isPermanent({ code: 'functions/unavailable' })).toBe(false);
    expect(isPermanent({ code: 'functions/internal' })).toBe(false);
    expect(isPermanent({ code: 'functions/deadline-exceeded' })).toBe(false);
  });
});
