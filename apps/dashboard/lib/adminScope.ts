// Organization-scoped admin access helpers.
//
// organization_admin users have `organizationId` in their custom claims.
// super_admin / legacy_admin / bootstrap_admin have no org restriction — they
// see all data.  All other roles (support_agent, finance_admin, auditor) are
// cross-org by design.
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

export function getAdminScope(session: SessionResult & { state: 'authorized' }): AdminScope {
  if (!ORG_SCOPED_ROLES.has(session.role)) return { organizationId: undefined };
  const orgId = session.user.claims.organizationId;
  return { organizationId: typeof orgId === 'string' ? orgId : undefined };
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
