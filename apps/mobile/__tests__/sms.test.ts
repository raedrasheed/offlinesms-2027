import { describe, it, expect } from 'vitest';
import { buildDefaultSmsBody, smsSkipReasonCopy } from '../src/lib/sms.helpers';

describe('buildDefaultSmsBody', () => {
  it('uses OfflineSMS when no conversation name', () => {
    const body = buildDefaultSmsBody(null, 'hello world');
    expect(body).toContain('OfflineSMS');
    expect(body).toContain('hello world');
  });

  it('uses provided conversation name', () => {
    const body = buildDefaultSmsBody('Family Group', 'lunch?');
    expect(body).toContain('Family Group');
    expect(body).toContain('lunch?');
  });

  it('collapses whitespace in the message', () => {
    const body = buildDefaultSmsBody('Team', 'one    two\n\nthree');
    expect(body).toContain('one two three');
  });

  it('truncates very long messages with an ellipsis', () => {
    const long = 'x'.repeat(500);
    const body = buildDefaultSmsBody('Team', long);
    expect(body.length).toBeLessThan(300);
    expect(body).toContain('…');
  });

  it('keeps the closing CTA on every body', () => {
    const body = buildDefaultSmsBody('Team', 'short');
    expect(body).toContain('Open OfflineSMS');
  });

  it('never embeds raw newlines from the message body', () => {
    const body = buildDefaultSmsBody('Team', 'line1\nline2\nline3');
    expect(body).not.toContain('\n');
  });
});

describe('smsSkipReasonCopy', () => {
  it('returns a non-empty copy for every known skip reason', () => {
    const reasons = ['no-phone', 'unverified-phone', 'opt-out', 'duplicate-phone', 'already-sent-for-message', 'rate-limited', 'policy-blocked'] as const;
    for (const r of reasons) {
      const copy = smsSkipReasonCopy(r as any);
      expect(typeof copy).toBe('string');
      expect(copy.length).toBeGreaterThan(0);
    }
  });
});
