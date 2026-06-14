import { describe, it, expect } from 'vitest';
import {
  validateOrgAccountInput, deriveOrgSlug, ORG_PASSWORD_MIN,
  parseRecipientLine, parseRecipientsText, validateOrgSendInput,
  usageMonthKey, ORG_MSG_MAX_RECIPIENTS, ORG_MSG_TITLE_MAX, ORG_MSG_BODY_MAX,
} from '../lib/orgMessagingValidation';
import { canDo } from '../lib/adminPermissions';

const valid = {
  name: 'Acme University',
  email: 'Admin@Acme.edu',
  password: 'secret123',
  monthlyMessageLimit: '1000',
  status: 'active',
};

describe('validateOrgAccountInput', () => {
  it('accepts a valid payload and normalises name/email', () => {
    const out = validateOrgAccountInput(valid);
    expect(out).toEqual({
      name: 'Acme University',
      email: 'admin@acme.edu',
      password: 'secret123',
      monthlyMessageLimit: 1000,
      status: 'active',
    });
  });

  it('requires a name', () => {
    expect(validateOrgAccountInput({ ...valid, name: '   ' })).toEqual({ error: expect.stringMatching(/name is required/i) });
  });

  it('requires a valid email', () => {
    expect(validateOrgAccountInput({ ...valid, email: 'nope' })).toEqual({ error: expect.stringMatching(/valid admin email/i) });
    expect(validateOrgAccountInput({ ...valid, email: '' })).toEqual({ error: expect.stringMatching(/email is required/i) });
  });

  it('enforces password strength', () => {
    expect(validateOrgAccountInput({ ...valid, password: '' })).toEqual({ error: expect.stringMatching(/password is required/i) });
    expect(validateOrgAccountInput({ ...valid, password: 'short1' })).toEqual({ error: expect.stringMatching(new RegExp(`${ORG_PASSWORD_MIN} characters`)) });
    expect(validateOrgAccountInput({ ...valid, password: 'allletters' })).toEqual({ error: expect.stringMatching(/letter and one number/i) });
    expect(validateOrgAccountInput({ ...valid, password: '12345678' })).toEqual({ error: expect.stringMatching(/letter and one number/i) });
  });

  it('requires a positive whole monthly limit', () => {
    expect(validateOrgAccountInput({ ...valid, monthlyMessageLimit: '0' })).toEqual({ error: expect.stringMatching(/positive whole number/i) });
    expect(validateOrgAccountInput({ ...valid, monthlyMessageLimit: '-5' })).toEqual({ error: expect.stringMatching(/positive whole number/i) });
    expect(validateOrgAccountInput({ ...valid, monthlyMessageLimit: '1.5' })).toEqual({ error: expect.stringMatching(/positive whole number/i) });
    expect(validateOrgAccountInput({ ...valid, monthlyMessageLimit: 'abc' })).toEqual({ error: expect.stringMatching(/positive whole number/i) });
    expect(validateOrgAccountInput({ ...valid, monthlyMessageLimit: 9_999_999 })).toEqual({ error: expect.stringMatching(/or less/i) });
  });

  it('accepts a numeric monthly limit', () => {
    const out = validateOrgAccountInput({ ...valid, monthlyMessageLimit: 500 });
    expect(out).toMatchObject({ monthlyMessageLimit: 500 });
  });

  it('only allows active or suspended status', () => {
    expect(validateOrgAccountInput({ ...valid, status: 'disabled' })).toEqual({ error: expect.stringMatching(/active or suspended/i) });
    expect(validateOrgAccountInput({ ...valid, status: 'suspended' })).toMatchObject({ status: 'suspended' });
    // Missing status defaults to active.
    expect(validateOrgAccountInput({ ...valid, status: null })).toMatchObject({ status: 'active' });
  });
});

describe('deriveOrgSlug', () => {
  it('slugifies the name and appends the suffix', () => {
    expect(deriveOrgSlug('Acme University', 'a1b2c3')).toBe('acme-university-a1b2c3');
  });
  it('falls back for names with no slug-safe chars', () => {
    expect(deriveOrgSlug('!!!', 'a1b2c3')).toBe('org-a1b2c3');
  });
  it('stays within 40 characters', () => {
    const slug = deriveOrgSlug('A'.repeat(100), 'a1b2c3');
    expect(slug.length).toBeLessThanOrEqual(40);
  });
});

describe('organization_messaging capability matrix', () => {
  it('super_admin and organization_admin can manage organization messaging', () => {
    expect(canDo('super_admin', 'manage:organization_messaging')).toBe(true);
    expect(canDo('organization_admin', 'manage:organization_messaging')).toBe(true);
    expect(canDo('super_admin', 'view:organization_messaging')).toBe(true);
    expect(canDo('organization_admin', 'view:organization_messaging')).toBe(true);
  });

  it('other roles cannot access organization messaging', () => {
    for (const role of ['support_agent', 'finance_admin', 'auditor'] as const) {
      expect(canDo(role, 'view:organization_messaging')).toBe(false);
      expect(canDo(role, 'manage:organization_messaging')).toBe(false);
    }
  });
});

// ─── Phase 2: send-form parsing/validation ───────────────────────────────────

describe('usageMonthKey', () => {
  it('formats as YYYY-MM in UTC', () => {
    expect(usageMonthKey(new Date(Date.UTC(2026, 0, 15)))).toBe('2026-01');
    expect(usageMonthKey(new Date(Date.UTC(2026, 11, 31, 23, 59)))).toBe('2026-12');
  });
});

describe('parseRecipientLine', () => {
  it('accepts E.164 phones (with separators stripped)', () => {
    expect(parseRecipientLine('+970591234567')).toEqual({ phone: '+970591234567' });
    expect(parseRecipientLine(' +970 59-123-4567 ')).toEqual({ phone: '+970591234567' });
  });
  it('accepts user ids', () => {
    expect(parseRecipientLine('AbC123_xyz-9')).toEqual({ userId: 'AbC123_xyz-9' });
  });
  it('rejects malformed lines', () => {
    expect(parseRecipientLine('+12')).toBeNull();           // too short
    expect(parseRecipientLine('+abc')).toBeNull();          // not digits
    expect(parseRecipientLine('0591234567')).toBeNull();    // phone without +
    expect(parseRecipientLine('ab')).toBeNull();            // userId too short
    expect(parseRecipientLine('has spaces here')).toBeNull();
    expect(parseRecipientLine('')).toBeNull();
  });
});

describe('parseRecipientsText', () => {
  it('splits lines, skips blanks, dedupes, reports invalid', () => {
    const out = parseRecipientsText('+970591234567\n\nuser_123456\n+970591234567\nbad line\n');
    expect(out.recipients).toEqual([{ phone: '+970591234567' }, { userId: 'user_123456' }]);
    expect(out.invalid).toEqual(['bad line']);
  });
});

describe('validateOrgSendInput', () => {
  const ok = { title: 'Hello', body: 'World', recipientsText: '+970591234567\nuser_123456' };

  it('accepts a valid payload', () => {
    expect(validateOrgSendInput(ok)).toEqual({
      title: 'Hello', body: 'World',
      recipients: [{ phone: '+970591234567' }, { userId: 'user_123456' }],
    });
  });
  it('requires title and caps its length', () => {
    expect(validateOrgSendInput({ ...ok, title: ' ' })).toEqual({ error: expect.stringMatching(/title is required/i) });
    expect(validateOrgSendInput({ ...ok, title: 'x'.repeat(ORG_MSG_TITLE_MAX + 1) })).toEqual({ error: expect.stringMatching(/80 characters/i) });
  });
  it('requires body and caps its length', () => {
    expect(validateOrgSendInput({ ...ok, body: '' })).toEqual({ error: expect.stringMatching(/body is required/i) });
    expect(validateOrgSendInput({ ...ok, body: 'x'.repeat(ORG_MSG_BODY_MAX + 1) })).toEqual({ error: expect.stringMatching(/500 characters/i) });
  });
  it('rejects empty and invalid recipients', () => {
    expect(validateOrgSendInput({ ...ok, recipientsText: '\n \n' })).toEqual({ error: expect.stringMatching(/at least one recipient/i) });
    expect(validateOrgSendInput({ ...ok, recipientsText: 'not valid!' })).toEqual({ error: expect.stringMatching(/invalid recipient/i) });
  });
  it('enforces the per-send recipient cap', () => {
    const many = Array.from({ length: ORG_MSG_MAX_RECIPIENTS + 1 }, (_, i) => `user_${String(100000 + i)}`).join('\n');
    expect(validateOrgSendInput({ ...ok, recipientsText: many })).toEqual({ error: expect.stringMatching(/at most 500/i) });
  });
});

// ─── SMS escalation policy (delay + audience) ────────────────────────────────

import {
  validateEscalationSettings, resolveEscalationPolicy,
  ESCALATION_DELAY_MIN, ESCALATION_DELAY_MAX, DEFAULT_ESCALATION,
} from '../lib/orgMessagingValidation';

describe('validateEscalationSettings', () => {
  it('accepts a valid org default', () => {
    expect(validateEscalationSettings({ enabled: true, delayMinutes: 5, audience: 'unread_only' }))
      .toEqual({ enabled: true, delayMinutes: 5, audience: 'unread_only' });
  });
  it('treats the checkbox string "true" as enabled', () => {
    expect(validateEscalationSettings({ enabled: 'true', delayMinutes: '10', audience: 'everyone' }))
      .toEqual({ enabled: true, delayMinutes: 10, audience: 'everyone' });
  });
  it('rejects out-of-range / non-integer delays', () => {
    expect(validateEscalationSettings({ enabled: true, delayMinutes: 0, audience: 'unread_only' })).toHaveProperty('error');
    expect(validateEscalationSettings({ enabled: true, delayMinutes: ESCALATION_DELAY_MAX + 1, audience: 'unread_only' })).toHaveProperty('error');
    expect(validateEscalationSettings({ enabled: true, delayMinutes: 1.5, audience: 'unread_only' })).toHaveProperty('error');
  });
  it('rejects an unknown audience', () => {
    expect(validateEscalationSettings({ enabled: true, delayMinutes: 5, audience: 'nope' })).toHaveProperty('error');
  });
  it('honors the documented bounds', () => {
    expect(ESCALATION_DELAY_MIN).toBe(1);
    expect(ESCALATION_DELAY_MAX).toBe(1440);
  });
});

describe('resolveEscalationPolicy (org default + per-request override)', () => {
  const orgDefault = { enabled: true, delayMinutes: 5, audience: 'unread_only' as const };

  it('returns the org default when there is no override', () => {
    expect(resolveEscalationPolicy(orgDefault, null)).toEqual(orgDefault);
  });
  it('defaults to DISABLED when the org never configured escalation', () => {
    expect(resolveEscalationPolicy(undefined, null)).toMatchObject({ enabled: false });
  });
  it('applies a valid override on top of the default', () => {
    expect(resolveEscalationPolicy(orgDefault, { delayMinutes: 30, audience: 'everyone' }))
      .toEqual({ enabled: true, delayMinutes: 30, audience: 'everyone' });
    expect(resolveEscalationPolicy(orgDefault, { enabled: false })).toMatchObject({ enabled: false, delayMinutes: 5 });
  });
  it('rejects a bad override', () => {
    expect(resolveEscalationPolicy(orgDefault, { delayMinutes: 0 })).toHaveProperty('error');
    expect(resolveEscalationPolicy(orgDefault, { audience: 'nope' })).toHaveProperty('error');
    expect(resolveEscalationPolicy(orgDefault, { enabled: 'yes' as never })).toHaveProperty('error');
    expect(resolveEscalationPolicy(orgDefault, 5 as never)).toHaveProperty('error');
  });
  it('the shipped default is 5 minutes / unread_only / enabled', () => {
    expect(DEFAULT_ESCALATION).toEqual({ enabled: true, delayMinutes: 5, audience: 'unread_only' });
  });
});
