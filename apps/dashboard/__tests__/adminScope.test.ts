import { describe, it, expect } from 'vitest';
import { getAdminScope, canViewOrganization, isPlatformAdmin, organizationClaim } from '../lib/adminScope';
import type { SessionResult } from '../lib/session';

function makeSession(role: any, organizationId?: string): SessionResult & { state: 'authorized' } {
  return {
    state: 'authorized',
    user: {
      uid: 'u1',
      email: 'u1@example.com',
      claims: organizationId ? { organizationId } : {},
    },
    role,
  };
}

describe('getAdminScope', () => {
  it('returns undefined orgId for super_admin', () => {
    expect(getAdminScope(makeSession('super_admin', 'org-ignored')).organizationId).toBeUndefined();
  });

  it('returns undefined orgId for legacy_admin', () => {
    expect(getAdminScope(makeSession('legacy_admin', 'org-x')).organizationId).toBeUndefined();
  });

  it('returns undefined orgId for bootstrap_admin', () => {
    expect(getAdminScope(makeSession('bootstrap_admin', 'org-x')).organizationId).toBeUndefined();
  });

  it('returns undefined orgId for support_agent / finance_admin / auditor', () => {
    expect(getAdminScope(makeSession('support_agent', 'org-x')).organizationId).toBeUndefined();
    expect(getAdminScope(makeSession('finance_admin', 'org-x')).organizationId).toBeUndefined();
    expect(getAdminScope(makeSession('auditor', 'org-x')).organizationId).toBeUndefined();
  });

  it('returns the claim orgId for organization_admin', () => {
    expect(getAdminScope(makeSession('organization_admin', 'org-acme')).organizationId).toBe('org-acme');
  });

  // Codex R6-1: an organization admin without an organization must never get
  // the unrestricted (platform-wide) scope.
  it('refuses organization_admin with a missing, blank or non-string claim', () => {
    expect(() => getAdminScope(makeSession('organization_admin'))).toThrow(/without an organizationId/);
    for (const bad of ['', '   ', 123, null, ['org-a']]) {
      const session = makeSession('organization_admin') as any;
      session.user.claims.organizationId = bad;
      expect(() => getAdminScope(session), JSON.stringify(bad)).toThrow(/without an organizationId/);
    }
  });
});

describe('organizationClaim', () => {
  it('accepts only a non-blank string', () => {
    expect(organizationClaim({ organizationId: 'org-a' })).toBe('org-a');
    expect(organizationClaim({})).toBeNull();
    expect(organizationClaim({ organizationId: ' ' })).toBeNull();
    expect(organizationClaim({ organizationId: 7 })).toBeNull();
  });
});

describe('isPlatformAdmin', () => {
  it('is true only for super_admin and legacy_admin', () => {
    expect(isPlatformAdmin(makeSession('super_admin'))).toBe(true);
    expect(isPlatformAdmin(makeSession('legacy_admin'))).toBe(true);
    for (const role of ['bootstrap_admin', 'organization_admin', 'support_agent', 'finance_admin', 'auditor']) {
      expect(isPlatformAdmin(makeSession(role)), role).toBe(false);
    }
  });

  it('is false for an organization_admin whatever the organization claim says', () => {
    expect(isPlatformAdmin(makeSession('organization_admin'))).toBe(false);
    expect(isPlatformAdmin(makeSession('organization_admin', 'org-acme'))).toBe(false);
  });
});

describe('canViewOrganization', () => {
  it('unrestricted roles can view any org', () => {
    expect(canViewOrganization(makeSession('super_admin'), 'org-a')).toBe(true);
    expect(canViewOrganization(makeSession('support_agent'), 'org-a')).toBe(true);
    expect(canViewOrganization(makeSession('finance_admin'), 'org-a')).toBe(true);
  });

  it('org_admin can view own org', () => {
    expect(canViewOrganization(makeSession('organization_admin', 'org-acme'), 'org-acme')).toBe(true);
  });

  it('org_admin cannot view other orgs', () => {
    expect(canViewOrganization(makeSession('organization_admin', 'org-acme'), 'org-other')).toBe(false);
  });
});
