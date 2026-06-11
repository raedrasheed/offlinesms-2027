import { describe, it, expect } from 'vitest';
import { buildDefaultSmsBody, smsSkipReasonCopy } from '../src/lib/sms.helpers';

describe('buildDefaultSmsBody', () => {
  it('defaults to the original message text', () => {
    expect(buildDefaultSmsBody('hello world')).toBe('hello world');
  });

  it('returns empty for a missing message', () => {
    expect(buildDefaultSmsBody(null)).toBe('');
    expect(buildDefaultSmsBody(undefined)).toBe('');
  });

  it('collapses whitespace in the message', () => {
    expect(buildDefaultSmsBody('one    two\n\nthree')).toBe('one two three');
  });

  it('truncates very long messages with an ellipsis at the 320-char cap', () => {
    const body = buildDefaultSmsBody('x'.repeat(500));
    expect(body.length).toBe(320);
    expect(body).toContain('…');
  });

  it('never embeds raw newlines from the message body', () => {
    expect(buildDefaultSmsBody('line1\nline2\nline3')).not.toContain('\n');
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
