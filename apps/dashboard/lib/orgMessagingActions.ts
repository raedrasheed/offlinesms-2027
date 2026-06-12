'use server';

// Organization Messaging — super-admin server action to create an organization
// account (org doc + Firebase Auth admin user + custom claims). Phase 1.
//
// Auth model: this is a platform action, so it requires the
// manage:organization_messaging capability AND an UNRESTRICTED scope
// (organizationId === undefined). That blocks organization_admins — who are
// org-scoped — from creating organizations, while super_admin / legacy /
// bootstrap admins can. Mirrors the isPlatformAdmin pattern in the settings page.

import { cookies } from 'next/headers';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from './firebase-admin';
import { verifySession } from './session';
import { canDo } from './adminPermissions';
import { getAdminScope, canViewOrganization } from './adminScope';
import { validateOrgAccountInput, deriveOrgSlug, validateOrgSendInput } from './orgMessagingValidation';

export type OrgAccountActionState =
  | { error: string }
  | { success: true; organizationId: string; adminUid: string }
  | null;

export async function createOrganizationAccount(
  _prev: OrgAccountActionState,
  data: FormData,
): Promise<OrgAccountActionState> {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized'
      || !canDo(session.role, 'manage:organization_messaging')
      || getAdminScope(session).organizationId !== undefined) {
    return { error: 'Only platform super admins can create organization accounts.' };
  }

  const parsed = validateOrgAccountInput({
    name:                data.get('name')?.toString() ?? null,
    email:               data.get('email')?.toString() ?? null,
    password:            data.get('password')?.toString() ?? null,
    monthlyMessageLimit: data.get('monthlyMessageLimit')?.toString() ?? null,
    status:              data.get('status')?.toString() ?? null,
  });
  if ('error' in parsed) return parsed;

  // 1) Create the Firebase Auth user for the org admin.
  let adminUid: string;
  try {
    const user = await adminAuth.createUser({
      email:         parsed.email,
      password:      parsed.password,
      emailVerified: false,
      displayName:   parsed.name,
    });
    adminUid = user.uid;
  } catch (e: any) {
    if (e?.code === 'auth/email-already-exists') {
      return { error: 'That admin email is already in use.' };
    }
    if (e?.code === 'auth/invalid-password') {
      return { error: 'Password rejected by auth provider — choose a stronger one.' };
    }
    return { error: 'Could not create the admin account. Please try again.' };
  }

  // 2) Create the organization doc. A unique slug is derived from the name.
  const orgRef = adminDb.collection('organizations').doc();
  const slug = deriveOrgSlug(parsed.name, orgRef.id.slice(0, 6).toLowerCase());
  try {
    await orgRef.set({
      name:                parsed.name,
      slug,
      status:              parsed.status,
      ownerUid:            adminUid,
      adminUid,
      adminEmail:          parsed.email,
      monthlyMessageLimit: parsed.monthlyMessageLimit,
      // Keep the existing org settings shape so the rest of the dashboard reads it.
      settings: {
        smsEscalationEnabled: false,
        pointsEnabled:        false,
        defaultLanguage:      'en',
        timezone:             'UTC',
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: session.user.uid,
    });
  } catch {
    // Roll back the auth user so a failed org write doesn't orphan an account.
    try { await adminAuth.deleteUser(adminUid); } catch { /* best-effort */ }
    return { error: 'Could not create the organization. Please try again.' };
  }

  // 3) Scope the admin to this org via custom claims (same shape the rest of the
  //    project uses: role + organizationId).
  try {
    await adminAuth.setCustomUserClaims(adminUid, {
      role:           'organization_admin',
      organizationId: orgRef.id,
    });
  } catch {
    try { await adminAuth.deleteUser(adminUid); } catch { /* best-effort */ }
    try { await orgRef.delete(); } catch { /* best-effort */ }
    return { error: 'Could not finalize the admin role. Please try again.' };
  }

  // 4) Audit (soft-fail), matching the existing dashboard audit shape.
  try {
    await adminDb.collection('auditLogs').add({
      action:     'organization.account.created',
      actorUid:   session.user.uid,
      actorEmail: session.user.email ?? null,
      targetType: 'organization',
      targetId:   orgRef.id,
      result:     'success',
      metadata:   {
        name:                parsed.name,
        slug,
        status:              parsed.status,
        monthlyMessageLimit: parsed.monthlyMessageLimit,
        adminUid,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch { /* soft-fail */ }

  return { success: true, organizationId: orgRef.id, adminUid };
}

// ─── Send message (dashboard form) ────────────────────────────────────────────
// Phase 2 wires the form + scoping + validation; the actual batch/log creation
// (shared with the API endpoint) lands with the messaging backend phase. Until
// then this returns an honest "not enabled" error — nothing is recorded and
// nothing is ever marked sent/delivered.

export type OrgSendActionState =
  | { error: string }
  | { success: true; batchId: string; total: number; accepted: number; failed: number }
  | null;

export async function sendOrganizationMessage(
  organizationId: string,
  _prev: OrgSendActionState,
  data: FormData,
): Promise<OrgSendActionState> {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized' || !canDo(session.role, 'manage:organization_messaging')) {
    return { error: 'Permission denied.' };
  }
  // organization_admin may only send for their own organization.
  if (!organizationId || !canViewOrganization(session, organizationId)) {
    return { error: 'You can only send messages for your own organization.' };
  }

  const parsed = validateOrgSendInput({
    title:          data.get('title')?.toString() ?? null,
    body:           data.get('body')?.toString() ?? null,
    recipientsText: data.get('recipients')?.toString() ?? null,
  });
  if ('error' in parsed) return parsed;

  return { error: 'Message sending is not enabled yet — the messaging backend is added in an upcoming update.' };
}
