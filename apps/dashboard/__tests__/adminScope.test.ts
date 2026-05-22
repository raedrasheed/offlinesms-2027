import { describe, it, expect } from 'vitest';
import { getAdminScope, canViewOrganization } from '../lib/adminScope';
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

  it('returns undefined orgId for organization_admin with missing claim', () => {
    expect(getAdminScope(makeSession('organization_admin')).organizationId).toBeUndefined();
  });

  it('returns undefined orgId for organization_admin with non-string claim', () => {
    const session = makeSession('organization_admin') as any;
    session.user.claims.organizationId = 123;
    expect(getAdminScope(session).organizationId).toBeUndefined();
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
