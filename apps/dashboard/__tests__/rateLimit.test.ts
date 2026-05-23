import { describe, it, expect } from 'vitest';
import { checkRateLimit, LIMITS } from '../lib/rateLimit';

describe('checkRateLimit', () => {
  it('allows first request under the limit', () => {
    const r = checkRateLimit('test-key-1', { maxRequests: 3, windowMs: 60_000 });
    expect(r.ok).toBe(true);
  });

  it('allows up to maxRequests within window', () => {
    const key = 'test-key-2';
    const opts = { maxRequests: 5, windowMs: 60_000 };
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, opts).ok).toBe(true);
    }
  });

  it('blocks the (maxRequests + 1)-th request with a retryAfterMs', () => {
    const key = 'test-key-3';
    const opts = { maxRequests: 2, windowMs: 60_000 };
    checkRateLimit(key, opts);
    checkRateLimit(key, opts);
    const blocked = checkRateLimit(key, opts);
    expect(blocked.ok).toBe(false);
    expect(typeof blocked.retryAfterMs).toBe('number');
    expect(blocked.retryAfterMs!).toBeGreaterThan(0);
    expect(blocked.retryAfterMs!).toBeLessThanOrEqual(60_000);
  });

  it('isolates limits per key', () => {
    const a = 'test-key-iso-a';
    const b = 'test-key-iso-b';
    const opts = { maxRequests: 1, windowMs: 60_000 };
    expect(checkRateLimit(a, opts).ok).toBe(true);
    expect(checkRateLimit(b, opts).ok).toBe(true);
    expect(checkRateLimit(a, opts).ok).toBe(false);
    expect(checkRateLimit(b, opts).ok).toBe(false);
  });

  it('LIMITS shape matches contract', () => {
    expect(LIMITS.search.maxRequests).toBe(60);
    expect(LIMITS.search.windowMs).toBe(60_000);
    expect(LIMITS.export.maxRequests).toBe(10);
    expect(LIMITS.export.windowMs).toBe(3_600_000);
    expect(LIMITS.auditExport.maxRequests).toBe(5);
    expect(LIMITS.auditExport.windowMs).toBe(3_600_000);
  });
});
