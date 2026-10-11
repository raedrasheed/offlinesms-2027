// Organization-scoped admin access helpers.
//
// organization_admin users have `organizationId` in their custom claims.
// super_admin / legacy_admin / bootstrap_admin have no org restriction — they
// see all data.  All other roles (support_agent, finance_admin, auditor) are
// cross-org by design.
//
// An organization_admin WITHOUT a usable organizationId must never read as
// unrestricted: verifySession refuses such a session, and getAdminScope throws
// rather than return the platform-wide scope. Platform-only settings (the
// verification-SMS policy, relay caps) check the role itself with
// isPlatformAdmin, not the absence of an organization.
//
// Usage:
//   const scope = getAdminScope(session);
//   let q = adminDb.collection('users').orderBy('createdAt', 'desc');
//   q = applyOrgScope(q, scope);          // noop unless org_admin
//   q = applyOrgScope(q, scope, 'ownerOrganizationId');   // custom field

import type { SessionResult } from './session';

export type AdminScope = {
  organizationId: string | undefined;
};

const ORG_SCOPED_ROLES = new Set(['organization_admin']);
/** Roles that administer the whole platform. bootstrap_admin is temporary access
 *  for promoting the first admin and is deliberately not one of them. */
const PLATFORM_ROLES = new Set(['super_admin', 'legacy_admin']);

/** The organization an organization_admin is bound to: a non-blank string claim, else null. */
export function organizationClaim(claims: Record<string, unknown>): string | null {
  const v = claims.organizationId;
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

export function getAdminScope(session: SessionResult & { state: 'authorized' }): AdminScope {
  if (!ORG_SCOPED_ROLES.has(session.role)) return { organizationId: undefined };
  const orgId = organizationClaim(session.user.claims);
  if (!orgId) throw new Error('organization_admin session without an organizationId claim');
  return { organizationId: orgId };
}

/** Platform-wide settings: an explicit platform role, never "no organization". */
export function isPlatformAdmin(session: SessionResult & { state: 'authorized' }): boolean {
  return PLATFORM_ROLES.has(session.role);
}

export function applyOrgScope(
  query: FirebaseFirestore.Query,
  scope: AdminScope,
  field = 'organizationId',
): FirebaseFirestore.Query {
  if (!scope.organizationId) return query;
  return query.where(field, '==', scope.organizationId);
}

export function canViewOrganization(
  session: SessionResult & { state: 'authorized' },
  organizationId: string,
): boolean {
  const scope = getAdminScope(session);
  if (!scope.organizationId) return true; // unrestricted role
  return scope.organizationId === organizationId;
}
