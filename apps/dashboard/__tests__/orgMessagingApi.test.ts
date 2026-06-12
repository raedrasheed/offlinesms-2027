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

// ─── Phase 5: shared submission helpers (used by API route + dashboard) ──────

import {
  actorForContext, createdByForContext, classifyRecipientResolution,
  batchDocFields, messageDocFields, summarizeItems as _sum,
  type SubmitContext, type ResolvedItem,
} from '../lib/orgMessagingApi';

const apiCtx: SubmitContext  = { source: 'api', keyId: 'key_123' };
const dashCtx: SubmitContext = { source: 'dashboard', userUid: 'admin_uid_1', userEmail: 'admin@acme.edu' };

describe('submit context (actor / createdBy / source)', () => {
  it('dashboard sends are attributed to the signed-in admin with source dashboard', () => {
    expect(actorForContext(dashCtx)).toEqual({ actorUid: 'admin_uid_1', actorEmail: 'admin@acme.edu' });
    expect(createdByForContext(dashCtx)).toBe('admin_uid_1');
    const fields = batchDocFields('org1', _sum([{ status: 'queued' }]), dashCtx);
    expect(fields).toMatchObject({ organizationId: 'org1', source: 'dashboard', createdBy: 'admin_uid_1' });
  });
  it('api sends are attributed to the key id (never the raw key)', () => {
    expect(actorForContext(apiCtx)).toEqual({ actorUid: 'apikey:key_123', actorEmail: null });
    const fields = batchDocFields('org1', _sum([{ status: 'queued' }]), apiCtx);
    expect(fields).toMatchObject({ source: 'api', createdBy: 'key_123' });
    expect(JSON.stringify(fields)).not.toContain('offmsg_live_');
  });
});

describe('classifyRecipientResolution — honest statuses', () => {
  const lookups = {
    userExists: (uid: string) => uid === 'existing_user',
    phoneToUid: (phone: string) => (phone === '+970591111111' ? 'linked_uid' : null),
  };

  it('existing userId → queued', () => {
    expect(classifyRecipientResolution({ userId: 'existing_user' }, lookups))
      .toEqual({ status: 'queued', failureReason: null, resolvedUserId: 'existing_user' });
  });
  it('unknown userId → failed(user_not_found)', () => {
    expect(classifyRecipientResolution({ userId: 'ghost_user' }, lookups))
      .toEqual({ status: 'failed', failureReason: 'user_not_found', resolvedUserId: null });
  });
  it('phone linked to a user → queued with resolvedUserId', () => {
    expect(classifyRecipientResolution({ phone: '+970591111111' }, lookups))
      .toEqual({ status: 'queued', failureReason: null, resolvedUserId: 'linked_uid' });
  });
  it('unlinked phone → unsupported_recipient(phone_not_linked_to_user)', () => {
    expect(classifyRecipientResolution({ phone: '+970599999999' }, lookups))
      .toEqual({ status: 'unsupported_recipient', failureReason: 'phone_not_linked_to_user', resolvedUserId: null });
  });
  it('never produces sent/delivered/seen', () => {
    const all = [
      classifyRecipientResolution({ userId: 'existing_user' }, lookups),
      classifyRecipientResolution({ userId: 'ghost' }, lookups),
      classifyRecipientResolution({ phone: '+970591111111' }, lookups),
      classifyRecipientResolution({ phone: '+1234567890' }, lookups),
    ];
    for (const r of all) expect(['queued', 'failed', 'unsupported_recipient']).toContain(r.status);
  });
});

describe('messageDocFields (per-recipient log shape)', () => {
  const base = { title: 'T', body: 'B' };
  it('records phone recipients with type/value and honest status', () => {
    const item: ResolvedItem = { ...base, recipient: { phone: '+970591111111' }, status: 'unsupported_recipient', failureReason: 'phone_not_linked_to_user', resolvedUserId: null };
    expect(messageDocFields('org1', 'batch1', item)).toEqual({
      organizationId: 'org1', batchId: 'batch1',
      recipientType: 'phone', recipientValue: '+970591111111',
      resolvedUserId: null, title: 'T', body: 'B',
      status: 'unsupported_recipient', failureReason: 'phone_not_linked_to_user',
    });
  });
  it('records userId recipients', () => {
    const item: ResolvedItem = { ...base, recipient: { userId: 'user_abc123' }, status: 'queued', failureReason: null, resolvedUserId: 'user_abc123' };
    expect(messageDocFields('org1', 'batch1', item)).toMatchObject({
      recipientType: 'userId', recipientValue: 'user_abc123', status: 'queued',
    });
  });
});

// ─── Phase 6: read models, scoping rule, usage math ──────────────────────────

import {
  mapBatchRow, mapMessageRow, canAccessBatch, percentUsed,
} from '../lib/orgMessagingApi';

describe('mapBatchRow / mapMessageRow — allow-list read models', () => {
  const ts = { toDate: () => new Date(1700000000000), toMillis: () => 1700000000000 };

  it('maps the batch fields and IGNORES anything else (keyHash can never leak)', () => {
    const row = mapBatchRow('b1', {
      organizationId: 'org1', source: 'api', createdBy: 'key_1', status: 'partial',
      total: 3, accepted: 1, queued: 1, failed: 1, unsupported: 1,
      createdAt: ts, completedAt: ts,
      keyHash: 'SECRET_HASH', authorization: 'Bearer offmsg_live_xyz', extra: 'junk',
    });
    expect(row).toEqual({
      id: 'b1', organizationId: 'org1', source: 'api', createdBy: 'key_1', status: 'partial',
      total: 3, accepted: 1, queued: 1, failed: 1, unsupported: 1,
      createdAt: new Date(1700000000000).toISOString(),
      completedAt: new Date(1700000000000).toISOString(),
    });
    expect(JSON.stringify(row)).not.toContain('SECRET_HASH');
    expect(JSON.stringify(row)).not.toContain('offmsg_live_');
  });

  it('maps message rows without secrets and with honest statuses', () => {
    const row = mapMessageRow('m1', {
      batchId: 'b1', recipientType: 'phone', recipientValue: '+970591111111',
      title: 'T', body: 'B', status: 'unsupported_recipient',
      failureReason: 'phone_not_linked_to_user', createdAt: ts,
      keyHash: 'SECRET', resolvedUserId: 'u1',
    });
    expect(Object.keys(row).sort()).toEqual([
      'batchId', 'body', 'createdAt', 'failureReason', 'id',
      'recipientType', 'recipientValue', 'status', 'title',
    ]);
    expect(JSON.stringify(row)).not.toContain('SECRET');
    expect(['queued', 'failed', 'unsupported_recipient', 'accepted']).toContain(row.status);
  });
});

describe('canAccessBatch — org scoping for batch/message reads', () => {
  it('org-scoped admins can only read their own organization batches', () => {
    expect(canAccessBatch('org1', 'org1')).toBe(true);    // organization_admin, own batch
    expect(canAccessBatch('org1', 'org2')).toBe(false);   // cross-org → rejected
  });
  it('unrestricted (super) admins can read any organization batch', () => {
    expect(canAccessBatch(undefined, 'org1')).toBe(true);
    expect(canAccessBatch(undefined, 'org2')).toBe(true);
  });
  it('a batch without an organization is never accessible', () => {
    expect(canAccessBatch(undefined, '')).toBe(false);
    expect(canAccessBatch('org1', '')).toBe(false);
  });
});

describe('usage math — only accepted/queued consume quota', () => {
  it('percentUsed clamps and handles no-limit orgs', () => {
    expect(percentUsed(1000, 250)).toBe(25);
    expect(percentUsed(100, 250)).toBe(100);
    expect(percentUsed(0, 50)).toBe(0);
    expect(percentUsed(3, 1)).toBe(33);
  });

  it('failed and unsupported recipients contribute 0 to the used counter', () => {
    // The service increments `used` by summary.accepted — which only counts queued.
    const summary = summarizeItems([
      { status: 'failed' }, { status: 'unsupported_recipient' }, { status: 'failed' },
    ]);
    expect(summary.accepted).toBe(0);

    const mixed = summarizeItems([
      { status: 'queued' }, { status: 'failed' }, { status: 'unsupported_recipient' },
    ]);
    expect(mixed.accepted).toBe(1);   // exactly the queued one
  });
});

// ─── Phase 7: hardening pins ─────────────────────────────────────────────────

describe('status vocabulary hardening', () => {
  it('excludes seen as well as sent/delivered', () => {
    expect(ORG_MESSAGE_STATUSES).not.toContain('seen');
    expect(ORG_MESSAGE_STATUSES).not.toContain('sent');
    expect(ORG_MESSAGE_STATUSES).not.toContain('delivered');
  });
});

describe('audit/actor metadata can never carry a raw bearer token', () => {
  it('every context-derived shape stays free of the key material', () => {
    const rawKey = generateApiKey().raw;
    // Even if a caller (wrongly) embedded the raw key in the key id field,
    // the documented context shape only ever receives the Firestore keyId —
    // assert the standard shapes built from a real keyId are clean.
    const ctx = { source: 'api' as const, keyId: 'k_abc12345' };
    const shapes = [
      actorForContext(ctx),
      batchDocFields('org1', _sum([{ status: 'queued' }]), ctx),
      { createdBy: createdByForContext(ctx) },
    ];
    for (const s of shapes) {
      const json = JSON.stringify(s);
      expect(json).not.toContain(rawKey);
      expect(json).not.toContain('offmsg_live_');
      expect(json).not.toContain('Bearer ');
    }
  });
});
