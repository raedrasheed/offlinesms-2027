'use server';

// Organization Messaging — super-admin server action to create an organization
// account (org doc + Firebase Auth admin user + custom claims). Phase 1.
//
// Auth model: this is a platform action, so it requires the
// manage:organization_messaging capability AND a platform admin role, named
// explicitly (isPlatformAdmin: super_admin or the legacy admin claim), never
// inferred from a missing organizationId (Codex R6-1). Same check as the
// settings page and relay caps.

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from './firebase-admin';
import { verifySession } from './session';
import { canDo } from './adminPermissions';
import { getAdminScope, canViewOrganization, isPlatformAdmin, organizationClaim } from './adminScope';
import {
  validateOrgAccountInput, deriveOrgSlug, validateOrgSendInput,
  validateEscalationSettings, ORG_MSG_MAX_RECIPIENTS, type OrgSmsIdentification,
} from './orgMessagingValidation';
import { API_ERRORS, parseSendRequest, type SendItem } from './orgMessagingApi';
import { generateApiKey } from './orgMessagingKeys';
import { submitOrganizationMessageBatch, type SubmitFailureCode } from './orgMessagingService';
import {
  getRecipientGroup, saveRecipientGroupChange, saveRecipientGroupDefinitionChange, saveRecipientGroupImport,
  type RecipientGroupChange, type RecipientGroupDefinitionChange,
} from './orgRecipientGroups';
import { isRecipientGroupId, parseGroupRecipient, type GroupRecipient } from './recipientGroupValidation';
import { organizationAccountDocument } from './organizationAccount';

export type OrgAccountActionState =
  | { error: string }
  | { success: true; organizationId: string; adminUid: string }
  | null;

export async function createOrganizationAccount(
  _prev: OrgAccountActionState,
  data: FormData,
): Promise<OrgAccountActionState> {
  const cookie = (await cookies()).get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized'
      || !canDo(session.role, 'manage:organization_messaging')
      || !isPlatformAdmin(session)) {
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
    await orgRef.set(organizationAccountDocument({
      organizationId: orgRef.id,
      name: parsed.name,
      status: parsed.status,
      adminUid,
      adminEmail: parsed.email,
      monthlyMessageLimit: parsed.monthlyMessageLimit,
      createdBy: session.user.uid,
    }));
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
// Uses the SAME shared submission path as the public API endpoint
// (submitOrganizationMessageBatch): recipient resolution, org status check,
// transaction-safe quota, batch + per-recipient logs, usage counter, audit —
// with honest statuses only (queued/failed/unsupported_recipient; never
// sent/delivered). Source is 'dashboard' and createdBy is the signed-in admin.
//
// SECURITY: the Admin SDK bypasses Firestore rules, so authorization stays
// explicit here — capability + canViewOrganization are re-checked server-side
// regardless of what the page already verified, and the client-provided
// organizationId is never trusted on its own.

function revalidateOrgMessaging(...businessPages: string[]) {
  revalidatePath('/admin/organization-messaging');
  businessPages.forEach(path => revalidatePath(path));
}

const SEND_FAILURE_COPY: Record<SubmitFailureCode, string> = {
  organization_not_found: 'Organization not found.',
  organization_suspended: 'Organization is suspended — sending is disabled.',
  quota_exceeded:         'Monthly message quota exceeded.',
  invalid_escalation:     'Invalid escalation settings.',
  internal_error:         'Could not submit the messages. Please try again.',
};

export type OrgSendActionState =
  | { error: string }
  | {
      success: true;
      batchId: string;
      total: number;
      accepted: number;
      failed: number;
      unsupported: number;
      status: string;
      smsOnlyAccepted: number;
      escalationScheduled: boolean;
      escalationDelayMinutes: number;
      escalationAudience: string;
    }
  | null;

export type OrgGroupMessagePreview = { revision: string; members: GroupRecipient[] } | { error: string };

function groupMessagePreview(group: { revision: string; members: GroupRecipient[] }): OrgGroupMessagePreview {
  if (!Array.isArray(group.members) || !group.members.length) {
    return { error: 'The selected group is missing or empty.' };
  }

  const membersByPhone = new Map<string, GroupRecipient>();
  for (const member of group.members) {
    const parsed = parseGroupRecipient(member);
    if (!parsed) return { error: 'The selected group contains invalid recipient data.' };
    const { name, phone, message } = parsed;
    const existing = membersByPhone.get(phone);
    if (existing) {
      if (existing.message !== (message || undefined)) {
        return { error: 'The selected group has different messages for the same phone number.' };
      }
      continue;
    }
    membersByPhone.set(phone, { name, phone, ...(message && { message }) });
  }

  if (membersByPhone.size > ORG_MSG_MAX_RECIPIENTS) {
    return { error: `At most ${ORG_MSG_MAX_RECIPIENTS} recipients per send.` };
  }
  const members = [...membersByPhone.values()];
  if (!members.some(member => member.message)) return { error: 'The selected group has no saved Excel messages.' };
  return { revision: group.revision, members };
}

export async function previewOrganizationRecipientGroupMessages(
  organizationId: string,
  groupId: string,
): Promise<OrgGroupMessagePreview> {
  if (!(await recipientGroupManager(organizationId))) return { error: 'Permission denied.' };
  if (!isRecipientGroupId(organizationId) || !isRecipientGroupId(groupId)) {
    return { error: 'Select a valid group.' };
  }
  try {
    const group = await getRecipientGroup(organizationId, groupId);
    if (!group) return { error: 'The selected group is missing or empty.' };
    return groupMessagePreview(group);
  } catch { return { error: 'Could not load the selected group.' }; }
}

export async function sendOrganizationMessage(
  organizationId: string,
  _prev: OrgSendActionState,
  data: FormData,
): Promise<OrgSendActionState> {
  const useGroupMessages = data.get('useGroupMessages') === 'true';
  const session = useGroupMessages
    ? await recipientGroupManager(organizationId)
    : await verifySession((await cookies()).get('__session')?.value);
  if (session?.state !== 'authorized' || !canDo(session.role, 'manage:organization_messaging')) {
    return { error: 'Permission denied.' };
  }
  // organization_admin may only send for their own organization; super_admin
  // (unrestricted scope) may send for any selected organization.
  if (!organizationId || !canViewOrganization(session, organizationId)) {
    return { error: 'You can only send messages for your own organization.' };
  }

  let recipientsText = data.get('recipients')?.toString() ?? '';
  const title = data.get('title')?.toString() ?? null;
  const body = data.get('body')?.toString() ?? null;
  let group: Awaited<ReturnType<typeof getRecipientGroup>> = null;
  const groupId = data.get('recipientGroupId');
  if (useGroupMessages && (!isRecipientGroupId(organizationId) || !isRecipientGroupId(groupId))) {
    return { error: 'Choose a group to use its saved Excel messages.' };
  }
  if (groupId) {
    if (recipientsText.trim() || !isRecipientGroupId(groupId)) return { error: 'Choose a group or enter recipients manually.' };
    try {
      group = await getRecipientGroup(organizationId, groupId);
      if (!group?.members.length) return { error: 'The selected group is missing or empty.' };
      if (!useGroupMessages) recipientsText = group.members.map(member => member.phone).join('\n');
    } catch { return { error: 'Could not load the selected group.' }; }
  }

  let items: SendItem[];
  if (useGroupMessages && group) {
    if (data.get('recipientGroupRevision') !== group.revision) {
      return { error: 'The group changed. Reload the Excel message preview before sending.' };
    }
    const preview = groupMessagePreview(group);
    if ('error' in preview) return preview;
    if (!body?.trim() && preview.members.some(member => !member.message)) {
      return { error: 'Enter a common message for recipients without an Excel message.' };
    }
    const parsed = parseSendRequest({
      messages: preview.members.map(member => ({ phone: member.phone, title, body: member.message ?? body })),
    });
    if ('errorCode' in parsed) return { error: parsed.message ?? API_ERRORS[parsed.errorCode].message };
    items = parsed.items;
  } else {
    const parsed = validateOrgSendInput({ title, body, recipientsText });
    if ('error' in parsed) return parsed;
    items = parsed.recipients.map(recipient => ({ recipient, title: parsed.title, body: parsed.body }));
  }

  const result = await submitOrganizationMessageBatch(organizationId, items, {
    source:    'dashboard',
    userUid:   session.user.uid,
    userEmail: session.user.email ?? null,
  }, { recipientGroupName: group?.name });
  if (!result.ok) return { error: result.message ?? SEND_FAILURE_COPY[result.code] };
  revalidateOrgMessaging('/business', '/business/activity', '/business/send');

  return {
    success:     true,
    batchId:     result.batchId,
    total:       result.summary.total,
    accepted:    result.summary.accepted,
    failed:      result.summary.failed,
    unsupported: result.summary.unsupported,
    status:      result.summary.batchStatus,
    smsOnlyAccepted:        result.smsOnlyAccepted,
    escalationScheduled:    result.escalationScheduled,
    escalationDelayMinutes: result.escalation.delayMinutes,
    escalationAudience:     result.escalation.audience,
  };
}

async function recipientGroupManager(organizationId: string) {
  const session = await verifySession((await cookies()).get('__session')?.value);
  if (session.state !== 'authorized' || !canDo(session.role, 'manage:organization_messaging')
      || (session.role !== 'organization_admin' && !isPlatformAdmin(session))
      || (session.role === 'organization_admin' && !organizationClaim(session.user.claims))
      || !canViewOrganization(session, organizationId)) return null;
  return session;
}

export async function importOrganizationRecipients(
  organizationId: string,
  input: Parameters<typeof saveRecipientGroupImport>[2],
) {
  const session = await recipientGroupManager(organizationId);
  if (!session) return { error: 'Permission denied.' };
  if (!isRecipientGroupId(organizationId) || !input || typeof input !== 'object') return { error: 'Invalid import.' };
  try {
    const result = await saveRecipientGroupImport(organizationId, session.user.uid, input);
    if ('groupId' in result) revalidateOrgMessaging('/business', '/business/groups', '/business/send');
    return result;
  } catch {
    return { error: 'Could not import recipients. Try again.' };
  }
}

export async function manageOrganizationRecipients(
  organizationId: string,
  groupId: string,
  change: RecipientGroupChange,
) {
  const session = await recipientGroupManager(organizationId);
  if (!session) return { error: 'Permission denied.' };
  if (!isRecipientGroupId(organizationId)) return { error: 'Invalid organization.' };
  try {
    const result = await saveRecipientGroupChange(organizationId, session.user.uid, groupId, change);
    if ('members' in result) revalidateOrgMessaging('/business', '/business/groups', '/business/send');
    return result;
  } catch {
    return { error: 'Could not update recipients. Try again.' };
  }
}

export async function manageOrganizationRecipientGroup(
  organizationId: string,
  groupId: string,
  change: RecipientGroupDefinitionChange,
): Promise<{ success: true } | { error: string }> {
  const session = await recipientGroupManager(organizationId);
  if (!session) return { error: 'Permission denied.' };
  if (!isRecipientGroupId(organizationId)) return { error: 'Invalid organization.' };
  try {
    const result = await saveRecipientGroupDefinitionChange(organizationId, session.user.uid, groupId, change);
    if ('success' in result) revalidateOrgMessaging('/business', '/business/groups', '/business/send');
    return result;
  } catch {
    return { error: 'Could not update the group. Try again.' };
  }
}

// ─── Escalation settings (org default: delay + SMS audience) ─────────────────
// The org admin sets the check period (minutes) and which users get the SMS —
// unread_only / undelivered_only / everyone — mirroring the app's escalation.

export type OrgEscalationActionState = { error: string } | { success: true } | null;

export async function updateOrgEscalationSettings(
  organizationId: string,
  _prev: OrgEscalationActionState,
  data: FormData,
): Promise<OrgEscalationActionState> {
  const cookie = (await cookies()).get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized' || !canDo(session.role, 'manage:organization_messaging')) {
    return { error: 'Permission denied.' };
  }
  if (!organizationId || !canViewOrganization(session, organizationId)) {
    return { error: 'You can only manage your own organization.' };
  }

  const parsed = validateEscalationSettings({
    enabled:      data.getAll('escalationEnabled').includes('true'),
    delayMinutes: data.get('delayMinutes')?.toString() ?? null,
    audience:     data.get('audience')?.toString() ?? null,
  });
  if ('error' in parsed) return parsed;

  const organizationName = data.get('smsShowOrganizationName');
  const recipientGroupName = data.get('smsShowRecipientGroupName');
  let smsIdentification: OrgSmsIdentification | undefined;
  if (organizationName !== null || recipientGroupName !== null) {
    if ((organizationName !== 'true' && organizationName !== 'false')
        || (recipientGroupName !== 'true' && recipientGroupName !== 'false')) {
      return { error: 'Reload settings before saving the SMS identification options.' };
    }
    smsIdentification = {
      showOrganizationName: organizationName === 'true',
      showRecipientGroupName: recipientGroupName === 'true',
    };
  }
  const settings = { messagingEscalation: parsed, ...(smsIdentification && { smsIdentification }) };

  try {
    await adminDb.collection('organizations').doc(organizationId)
      .set({ ...settings, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  } catch {
    return { error: 'Could not save the escalation settings. Please try again.' };
  }

  try {
    await adminDb.collection('auditLogs').add({
      action:     'organization_messaging_settings_updated',
      actorUid:   session.user.uid,
      actorEmail: session.user.email ?? null,
      targetType: 'organization',
      targetId:   organizationId,
      result:     'success',
      metadata:   { ...parsed, ...(smsIdentification && { smsIdentification }) },
      createdAt:  FieldValue.serverTimestamp(),
    });
  } catch { /* soft-fail */ }

  revalidateOrgMessaging('/business/send');
  return { success: true };
}

// ─── API key management (Phase 3) ─────────────────────────────────────────────
// One active key per organization. Only the SHA-256 hash is persisted; the raw
// key exists solely in this action's return value (client state) and is gone
// after a refresh. Generating a new key revokes any previously active one;
// revoked rows are kept as history.

export type OrgApiKeyActionState =
  | { error: string }
  | { success: true; rawKey?: string }
  | null;

type OrgMessagingGate =
  | { error: string }
  | { error?: undefined; session: Awaited<ReturnType<typeof verifySession>> & { state: 'authorized' } };

async function requireOrgMessagingManager(organizationId: string): Promise<OrgMessagingGate> {
  const cookie = (await cookies()).get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized' || !canDo(session.role, 'manage:organization_messaging')) {
    return { error: 'Permission denied.' };
  }
  if (!organizationId || !canViewOrganization(session, organizationId)) {
    return { error: 'You can only manage the API key of your own organization.' };
  }
  const org = await adminDb.collection('organizations').doc(organizationId).get();
  if (!org.exists) return { error: 'Organization not found.' };
  return { session };
}

async function writeApiKeyAudit(
  action: 'organization_api_key_created' | 'organization_api_key_revoked',
  actorUid: string,
  actorEmail: string | undefined,
  organizationId: string,
  meta: Record<string, unknown>,
) {
  try {
    await adminDb.collection('auditLogs').add({
      action,
      actorUid,
      actorEmail: actorEmail ?? null,
      targetType: 'organization',
      targetId:   organizationId,
      result:     'success',
      metadata:   meta,
      createdAt:  FieldValue.serverTimestamp(),
    });
  } catch { /* soft-fail */ }
}

export async function generateOrgApiKey(
  organizationId: string,
  _prev: OrgApiKeyActionState,
  _data: FormData,
): Promise<OrgApiKeyActionState> {
  const gate = await requireOrgMessagingManager(organizationId);
  if (gate.error !== undefined) return { error: gate.error };
  const { session } = gate;

  const { raw, hash } = generateApiKey();
  const keysCol = adminDb.collection('organizationApiKeys');
  const newRef = keysCol.doc();

  // Revoke any active key and create the new one atomically, so there is
  // never a moment with two usable keys (or none recorded).
  try {
    await adminDb.runTransaction(async tx => {
      const active = await tx.get(
        keysCol.where('organizationId', '==', organizationId).where('status', '==', 'active'),
      );
      for (const docSnap of active.docs) {
        tx.update(docSnap.ref, {
          status:    'revoked',
          revokedAt: FieldValue.serverTimestamp(),
          revokedBy: session.user.uid,
        });
      }
      tx.set(newRef, {
        organizationId,
        keyHash:    hash,
        status:     'active',
        createdAt:  FieldValue.serverTimestamp(),
        createdBy:  session.user.uid,
        revokedAt:  null,
        revokedBy:  null,
        lastUsedAt: null,
      });
    });
  } catch {
    return { error: 'Could not generate the API key. Please try again.' };
  }

  await writeApiKeyAudit('organization_api_key_created', session.user.uid, session.user.email,
    organizationId, { keyId: newRef.id });

  revalidateOrgMessaging('/business/integrations');
  // The ONLY place the raw key ever leaves the server.
  return { success: true, rawKey: raw };
}

export async function revokeOrgApiKey(
  organizationId: string,
  _prev: OrgApiKeyActionState,
  _data: FormData,
): Promise<OrgApiKeyActionState> {
  const gate = await requireOrgMessagingManager(organizationId);
  if (gate.error !== undefined) return { error: gate.error };
  const { session } = gate;

  let revokedIds: string[] = [];
  try {
    const keysCol = adminDb.collection('organizationApiKeys');
    await adminDb.runTransaction(async tx => {
      const active = await tx.get(
        keysCol.where('organizationId', '==', organizationId).where('status', '==', 'active'),
      );
      revokedIds = active.docs.map(d => d.id);
      for (const docSnap of active.docs) {
        tx.update(docSnap.ref, {
          status:    'revoked',
          revokedAt: FieldValue.serverTimestamp(),
          revokedBy: session.user.uid,
        });
      }
    });
  } catch {
    return { error: 'Could not revoke the API key. Please try again.' };
  }
  if (revokedIds.length === 0) return { error: 'There is no active API key to revoke.' };

  await writeApiKeyAudit('organization_api_key_revoked', session.user.uid, session.user.email,
    organizationId, { keyIds: revokedIds });

  revalidateOrgMessaging('/business/integrations');
  return { success: true };
}
