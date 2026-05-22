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
