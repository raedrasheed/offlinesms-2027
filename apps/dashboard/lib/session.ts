// Server-side session verification for the admin dashboard.
//
// Phase 1 introduces a guard at `app/admin/layout.tsx` that:
//   1. Reads the `__session` HTTP-only cookie set by `/api/session`.
//   2. Verifies it via the Firebase Admin SDK.
//   3. Inspects custom claims to decide whether the caller may reach `/admin/*`.
//
// The role model is intentionally permissive in this phase: any of the
// following counts as "admin":
//   - `admin: true`             (legacy boolean — the existing model)
//   - `permissions.canAccessAdmin === true`  (forward-compat permission map)
//   - `role` ∈ ADMIN_ROLES      (forward-compat string role)
//   - `roles[]` intersects ADMIN_ROLES
//
// Phase 18 will replace these with a proper RBAC model; the rest of the
// dashboard already calls `requireAdmin()` so that migration is a one-file
// change.

import { adminAuth } from './firebase-admin';

export const ADMIN_ROLES = [
  'super_admin',
  'organization_admin',
  'support_agent',
  'finance_admin',
  'auditor',
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export type SessionUser = {
  uid: string;
  email?: string;
  claims: Record<string, unknown>;
};

export type SessionResult =
  | { state: 'unauthenticated' }
  | { state: 'forbidden'; user: SessionUser }
  | { state: 'authorized'; user: SessionUser; role: AdminRole | 'legacy_admin' | 'bootstrap_admin' };

const BOOTSTRAP_EMAILS = (process.env.BOOTSTRAP_ADMIN_EMAILS ?? '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

export function isAdminClaims(claims: Record<string, unknown>): AdminRole | 'legacy_admin' | null {
  if (claims.admin === true) return 'legacy_admin';

  const permissions = claims.permissions as Record<string, unknown> | undefined;
  if (permissions && permissions.canAccessAdmin === true) return 'legacy_admin';

  const singleRole = typeof claims.role === 'string' ? (claims.role as AdminRole) : null;
  if (singleRole && (ADMIN_ROLES as readonly string[]).includes(singleRole)) return singleRole;

  const roles = Array.isArray(claims.roles) ? (claims.roles as string[]) : [];
  const match = roles.find(r => (ADMIN_ROLES as readonly string[]).includes(r));
  if (match) return match as AdminRole;

  return null;
}

export async function verifySession(sessionCookie?: string): Promise<SessionResult> {
  if (!sessionCookie) return { state: 'unauthenticated' };

  let decoded;
  try {
    decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
  } catch {
    return { state: 'unauthenticated' };
  }

  const user: SessionUser = {
    uid: decoded.uid,
    email: decoded.email,
    claims: decoded as unknown as Record<string, unknown>,
  };

  const adminRole = isAdminClaims(user.claims);
  if (adminRole) return { state: 'authorized', user, role: adminRole };

  // Bootstrap allow-list: until a first real admin exists in the system, a
  // small list of emails can reach `/admin` to promote the first admin. This
  // is only consulted when no admin claim is present.
  if (user.email && BOOTSTRAP_EMAILS.includes(user.email.toLowerCase())) {
    return { state: 'authorized', user, role: 'bootstrap_admin' };
  }

  return { state: 'forbidden', user };
}
