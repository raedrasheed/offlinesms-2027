import { describe, it, expect } from 'vitest';
import {
  validateOrgAccountInput, deriveOrgSlug, ORG_PASSWORD_MIN,
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
