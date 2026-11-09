// Shared role constants. Mirrors apps/dashboard/lib/session.ts#ADMIN_ROLES
// without importing dashboard code into the functions bundle.

export const ADMIN_ROLES = [
  'super_admin',
  'organization_admin',
  'support_agent',
  'finance_admin',
  'auditor',
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export function hasSuperAdminRole(claims: Record<string, unknown>): boolean {
  const isAdminRole = (role: unknown): role is AdminRole =>
    typeof role === 'string' && (ADMIN_ROLES as readonly string[]).includes(role);

  // Match the dashboard's role resolution: an explicit role takes precedence.
  if (isAdminRole(claims.role)) return claims.role === 'super_admin';
  return Array.isArray(claims.roles) && claims.roles.find(isAdminRole) === 'super_admin';
}
