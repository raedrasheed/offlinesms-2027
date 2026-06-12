import { describe, it, expect } from 'vitest';
import {
  API_ERRORS, apiError, parseAuthHeader, parseRecipientObject,
  parseSendRequest, quotaAllows, summarizeItems,
} from '../lib/orgMessagingApi';
import { generateApiKey } from '../lib/orgMessagingKeys';
import { ORG_MESSAGE_STATUSES, ORG_MSG_MAX_RECIPIENTS } from '../lib/orgMessagingValidation';

const KEY = generateApiKey().raw;

describe('parseAuthHeader', () => {
  it('rejects a missing/empty/no-Bearer header', () => {
    expect(parseAuthHeader(null)).toEqual({ errorCode: 'missing_authorization' });
    expect(parseAuthHeader('')).toEqual({ errorCode: 'missing_authorization' });
    expect(parseAuthHeader(KEY)).toEqual({ errorCode: 'missing_authorization' });   // no Bearer prefix
  });
  it('rejects malformed keys with 401 invalid_key_format', () => {
    expect(parseAuthHeader('Bearer offmsg_live_short')).toEqual({ errorCode: 'invalid_key_format' });
    expect(parseAuthHeader('Bearer not-a-key')).toEqual({ errorCode: 'invalid_key_format' });
    expect(API_ERRORS.invalid_key_format.http).toBe(401);
    expect(API_ERRORS.missing_authorization.http).toBe(401);
  });
  it('accepts a well-formed bearer key (case-insensitive Bearer)', () => {
    expect(parseAuthHeader(`Bearer ${KEY}`)).toEqual({ key: KEY });
    expect(parseAuthHeader(`bearer ${KEY}`)).toEqual({ key: KEY });
  });
});

describe('error mapping', () => {
  it('maps the documented codes to the documented HTTP statuses', () => {
    expect(API_ERRORS.invalid_key.http).toBe(401);
    expect(API_ERRORS.revoked_key.http).toBe(401);
    expect(API_ERRORS.organization_suspended.http).toBe(403);
    expect(API_ERRORS.invalid_payload.http).toBe(400);
    expect(API_ERRORS.too_many_recipients.http).toBe(400);
    expect(API_ERRORS.quota_exceeded.http).toBe(429);
  });
  it('builds the structured failure body', () => {
    expect(apiError('quota_exceeded').body).toEqual({
      ok: false,
      error: { code: 'quota_exceeded', message: 'Monthly message quota exceeded.' },
    });
  });
});

describe('parseRecipientObject', () => {
  it('requires exactly one of phone | userId', () => {
    expect(parseRecipientObject({})).toBeNull();
    expect(parseRecipientObject({ phone: '+970591234567', userId: 'abc123' })).toBeNull();
  });
  it('validates phones like the dashboard (digits-only without + rejected)', () => {
    expect(parseRecipientObject({ phone: '+970591234567' })).toEqual({ phone: '+970591234567' });
    expect(parseRecipientObject({ phone: '0591234567' })).toBeNull();
  });
  it('validates userIds', () => {
    expect(parseRecipientObject({ userId: 'abc123' })).toEqual({ userId: 'abc123' });
    expect(parseRecipientObject({ userId: 'ab' })).toBeNull();
  });
});

describe('parseSendRequest — shape A', () => {
  const a = { title: 'Important Notice', body: 'Please review.', recipients: [{ phone: '+970591234567' }, { userId: 'abc123' }] };

  it('accepts the static shape and fans the message out', () => {
    const out = parseSendRequest(a);
    expect(out).toEqual({
      items: [
        { recipient: { phone: '+970591234567' }, title: 'Important Notice', body: 'Please review.' },
        { recipient: { userId: 'abc123' }, title: 'Important Notice', body: 'Please review.' },
      ],
    });
  });
  it('rejects missing/too-long title and body', () => {
    expect(parseSendRequest({ ...a, title: '' })).toMatchObject({ errorCode: 'invalid_payload' });
    expect(parseSendRequest({ ...a, title: 'x'.repeat(81) })).toMatchObject({ errorCode: 'invalid_payload' });
    expect(parseSendRequest({ ...a, body: undefined })).toMatchObject({ errorCode: 'invalid_payload' });
    expect(parseSendRequest({ ...a, body: 'x'.repeat(501) })).toMatchObject({ errorCode: 'invalid_payload' });
  });
  it('rejects empty and over-limit recipients', () => {
    expect(parseSendRequest({ ...a, recipients: [] })).toMatchObject({ errorCode: 'invalid_payload' });
    const many = Array.from({ length: ORG_MSG_MAX_RECIPIENTS + 1 }, () => ({ phone: '+970591234567' }));
    expect(parseSendRequest({ ...a, recipients: many })).toEqual({ errorCode: 'too_many_recipients' });
  });
  it('rejects bad recipient entries with a pointer', () => {
    const out = parseSendRequest({ ...a, recipients: [{ phone: '+970591234567' }, { phone: '12345' }] });
    expect(out).toMatchObject({ errorCode: 'invalid_payload', message: expect.stringContaining('recipients[1]') });
  });
});

describe('parseSendRequest — shape B', () => {
  const b = {
    messages: [
      { phone: '+970591111111', title: 'Financial Notice', body: 'Dear Ahmad, 120 NIS due.' },
      { userId: 'user_42xyz', title: 'Financial Notice', body: 'Dear Sara, 85 NIS due.' },
    ],
  };

  it('accepts per-recipient messages', () => {
    const out = parseSendRequest(b);
    expect(out).toEqual({
      items: [
        { recipient: { phone: '+970591111111' }, title: 'Financial Notice', body: 'Dear Ahmad, 120 NIS due.' },
        { recipient: { userId: 'user_42xyz' }, title: 'Financial Notice', body: 'Dear Sara, 85 NIS due.' },
      ],
    });
  });
  it('validates each message title/body with a pointer', () => {
    const out = parseSendRequest({ messages: [{ phone: '+970591111111', title: '', body: 'x' }] });
    expect(out).toMatchObject({ errorCode: 'invalid_payload', message: expect.stringContaining('messages[0].title') });
  });
  it('rejects both shapes together, neither shape, and non-objects', () => {
    expect(parseSendRequest({ ...b, recipients: [] })).toMatchObject({ errorCode: 'invalid_payload' });
    expect(parseSendRequest({})).toMatchObject({ errorCode: 'invalid_payload' });
    expect(parseSendRequest(null)).toMatchObject({ errorCode: 'invalid_payload' });
    expect(parseSendRequest([1, 2])).toMatchObject({ errorCode: 'invalid_payload' });
  });
});

describe('quotaAllows', () => {
  it('enforces the remaining monthly quota', () => {
    expect(quotaAllows(100, 0, 100)).toBe(true);
    expect(quotaAllows(100, 0, 101)).toBe(false);
    expect(quotaAllows(100, 90, 10)).toBe(true);
    expect(quotaAllows(100, 90, 11)).toBe(false);
    expect(quotaAllows(0, 0, 1)).toBe(false);       // unconfigured limit sends nothing
  });
});

describe('summarizeItems — honest statuses only', () => {
  it('counts queued as accepted and derives the batch status', () => {
    expect(summarizeItems([
      { status: 'queued' }, { status: 'queued' },
    ])).toEqual({ total: 2, accepted: 2, queued: 2, failed: 0, unsupported: 0, batchStatus: 'accepted' });

    expect(summarizeItems([
      { status: 'queued' }, { status: 'failed' }, { status: 'unsupported_recipient' },
    ])).toEqual({ total: 3, accepted: 1, queued: 1, failed: 1, unsupported: 1, batchStatus: 'partial' });

    expect(summarizeItems([
      { status: 'failed' }, { status: 'unsupported_recipient' },
    ])).toMatchObject({ accepted: 0, batchStatus: 'failed' });
  });

  it('the approved status vocabulary never includes sent/delivered', () => {
    expect(ORG_MESSAGE_STATUSES).not.toContain('sent');
    expect(ORG_MESSAGE_STATUSES).not.toContain('delivered');
    expect([...ORG_MESSAGE_STATUSES].sort()).toEqual(['accepted', 'failed', 'queued', 'unsupported_recipient']);
  });
});

describe('no raw API key leakage in error/response shapes', () => {
  it('error bodies never echo the key', () => {
    for (const code of Object.keys(API_ERRORS) as Array<keyof typeof API_ERRORS>) {
      expect(JSON.stringify(apiError(code).body)).not.toContain(KEY);
    }
  });
});
