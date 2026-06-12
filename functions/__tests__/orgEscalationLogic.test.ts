import { describe, it, expect } from 'vitest';
import {
  receiptToRowStatus, audienceIncludes, composeSmsText, groupBySmsText,
  escalationDue, SMS_TEXT_MAX,
} from '../src/orgMessaging/orgEscalationLogic';

describe('receiptToRowStatus (receipt-backed truth)', () => {
  it('maps read-like receipts to read', () => {
    expect(receiptToRowStatus('read')).toBe('read');
    expect(receiptToRowStatus('viewed')).toBe('read');
    expect(receiptToRowStatus('played')).toBe('read');
  });
  it('maps delivered to delivered', () => {
    expect(receiptToRowStatus('delivered')).toBe('delivered');
  });
  it('pending/failed/missing stay queued', () => {
    expect(receiptToRowStatus('pending')).toBe('queued');
    expect(receiptToRowStatus('failed')).toBe('queued');
    expect(receiptToRowStatus(null)).toBe('queued');
    expect(receiptToRowStatus(undefined)).toBe('queued');
  });
});

describe('audienceIncludes — the app\'s three escalation options', () => {
  it('unread_only targets everyone who has not read', () => {
    expect(audienceIncludes('unread_only', null)).toBe(true);
    expect(audienceIncludes('unread_only', 'pending')).toBe(true);
    expect(audienceIncludes('unread_only', 'delivered')).toBe(true);
    expect(audienceIncludes('unread_only', 'read')).toBe(false);
    expect(audienceIncludes('unread_only', 'viewed')).toBe(false);
  });
  it('undelivered_only targets missing/pending/failed receipts only', () => {
    expect(audienceIncludes('undelivered_only', null)).toBe(true);
    expect(audienceIncludes('undelivered_only', 'pending')).toBe(true);
    expect(audienceIncludes('undelivered_only', 'failed')).toBe(true);
    expect(audienceIncludes('undelivered_only', 'delivered')).toBe(false);
    expect(audienceIncludes('undelivered_only', 'read')).toBe(false);
  });
  it('everyone targets all recipients', () => {
    expect(audienceIncludes('everyone', 'read')).toBe(true);
    expect(audienceIncludes('everyone', null)).toBe(true);
  });
});

describe('composeSmsText', () => {
  it('joins title and body, collapsing whitespace', () => {
    expect(composeSmsText('Notice', 'Hello   world')).toBe('Notice: Hello world');
  });
  it('caps at the gateway limit', () => {
    const out = composeSmsText('T', 'x'.repeat(500));
    expect(out.length).toBe(SMS_TEXT_MAX);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('groupBySmsText', () => {
  it('one group for shape A, one per distinct text for shape B', () => {
    const rows = [
      { smsText: 'A: same', uid: 'u1' },
      { smsText: 'A: same', uid: 'u2' },
      { smsText: 'B: other', uid: 'u3' },
    ];
    const groups = groupBySmsText(rows);
    expect(groups.size).toBe(2);
    expect(groups.get('A: same')).toHaveLength(2);
    expect(groups.get('B: other')).toHaveLength(1);
  });
});

describe('escalationDue', () => {
  it('due only after escalateAt passes', () => {
    expect(escalationDue(1000, 999)).toBe(false);
    expect(escalationDue(1000, 1000)).toBe(true);
    expect(escalationDue(1000, 1001)).toBe(true);
    expect(escalationDue(0, 1001)).toBe(false);
  });
});
