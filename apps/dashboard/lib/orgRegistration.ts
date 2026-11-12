import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from './firebase-admin';
import { organizationClaim } from './adminScope';
import { organizationAccountDocument } from './organizationAccount';
import { isAdminClaims, isBootstrapAdminEmail } from './session';

export type OrganizationRegistrationStatus = 'pending' | 'approving' | 'approved' | 'rejected';
export type OrganizationRegistrationRow = {
  id: string;
  name: string;
  email: string;
  status: OrganizationRegistrationStatus;
  createdAt: number | null;
  organizationId: string | null;
  rejectionReason: string | null;
};

type Registration = {
  name: string;
  email: string;
  status: OrganizationRegistrationStatus;
  organizationId?: string;
  monthlyMessageLimit?: number;
  rejectionReason?: string;
  createdAt?: { toMillis(): number };
};
type Reviewer = { uid: string; email?: string };
type ReviewResult = { error: string } | { success: true; organizationId?: string };

function requests() {
  return adminDb.collection('organizationRegistrationRequests');
}

function publicStatus(data: Registration) {
  return {
    name: data.name,
    status: data.status,
    rejectionReason: data.status === 'rejected' ? data.rejectionReason ?? null : null,
  };
}

export function hasExistingAdminAccess(claims: Record<string, unknown>, email?: string): boolean {
  return !!isAdminClaims(claims) || !!organizationClaim(claims) || isBootstrapAdminEmail(email);
}

export function normalizeRegistrationName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length >= 2 && name.length <= 120 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
}

export async function getOrganizationRegistrationStatus(uid: string, email: string) {
  const data = (await requests().doc(uid).get()).data() as Registration | undefined;
  return data?.email === email ? publicStatus(data) : null;
}

export async function submitOrganizationRegistration(uid: string, email: string, name: string) {
  const ref = requests().doc(uid);
  return adminDb.runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as Registration | undefined;
    if (current) {
      return current.email === email ? publicStatus(current) : { error: 'registration_email_changed' as const };
    }
    const request: Registration = { name, email, status: 'pending' };
    tx.create(ref, { ...request, createdAt: FieldValue.serverTimestamp() });
    return publicStatus(request);
  });
}

export async function listOrganizationRegistrations(
  status: Exclude<OrganizationRegistrationStatus, 'approving'>,
): Promise<OrganizationRegistrationRow[]> {
  const query = status === 'pending'
    ? requests().where('status', 'in', ['pending', 'approving'])
    : requests().where('status', '==', status);
  const snapshot = await query.limit(100).get();
  return snapshot.docs.map(doc => {
    const data = doc.data() as Registration;
    return {
      id: doc.id,
      name: data.name,
      email: data.email,
      status: data.status,
      createdAt: data.createdAt?.toMillis() ?? null,
      organizationId: data.status === 'approved' ? data.organizationId ?? null : null,
      rejectionReason: data.rejectionReason ?? null,
    };
  }).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

function auditRegistration(reviewer: Reviewer, id: string, decision: 'approved' | 'rejected', organizationId?: string) {
  return {
    action: `organization.registration.${decision}`,
    actorUid: reviewer.uid,
    actorEmail: reviewer.email ?? null,
    targetType: 'organizationRegistration',
    targetId: id,
    result: 'success',
    metadata: organizationId ? { organizationId } : {},
    createdAt: FieldValue.serverTimestamp(),
  };
}

export async function rejectRegistration(id: string, reviewer: Reviewer, reason: string): Promise<ReviewResult> {
  const ref = requests().doc(id);
  const audit = adminDb.collection('auditLogs').doc();
  return adminDb.runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as Registration | undefined;
    if (!current) return { error: 'Registration request not found.' };
    if (current.status === 'rejected') return { success: true };
    if (current.status !== 'pending') return { error: 'This request can no longer be rejected.' };
    tx.update(ref, { status: 'rejected', rejectionReason: reason || null, reviewedBy: reviewer.uid, reviewedAt: FieldValue.serverTimestamp() });
    tx.create(audit, auditRegistration(reviewer, id, 'rejected'));
    return { success: true };
  });
}

export async function approveRegistration(id: string, reviewer: Reviewer, limit?: number): Promise<ReviewResult> {
  const ref = requests().doc(id);
  const organizations = adminDb.collection('organizations');
  const initial = (await ref.get()).data() as Registration | undefined;
  if (!initial) return { error: 'Registration request not found.' };
  if (initial.status === 'rejected') return { error: 'This request was already rejected.' };
  if (initial.status === 'approved') return { success: true, organizationId: initial.organizationId };

  const user = await adminAuth.getUser(id);
  const claims = user.customClaims ?? {};
  if (user.disabled || !user.emailVerified || user.email?.trim().toLowerCase() !== initial.email) {
    return { error: 'The applicant must have an active account with the original verified email.' };
  }
  let alreadyAssigned = false;
  if (hasExistingAdminAccess(claims, user.email)) {
    const latest = (await ref.get()).data() as Registration | undefined;
    if (latest?.status === 'approved') return { success: true, organizationId: latest.organizationId };
    alreadyAssigned = latest?.status === 'approving'
      && isAdminClaims(claims) === 'organization_admin'
      && organizationClaim(claims) === latest.organizationId;
    if (!alreadyAssigned) return { error: 'The applicant already has administrator access.' };
  }

  const proposedId = organizations.doc().id;
  const reserved = await adminDb.runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as Registration | undefined;
    if (!current || current.status === 'rejected') return { error: 'This request is unavailable for approval.' };
    if (current.status === 'approved') return { approvedId: current.organizationId };
    if (current.status === 'approving' && current.organizationId && current.monthlyMessageLimit) {
      return { organizationId: current.organizationId, limit: current.monthlyMessageLimit };
    }
    if (!limit) return { error: 'Set the monthly message limit.' };
    tx.update(ref, { status: 'approving', organizationId: proposedId, monthlyMessageLimit: limit });
    return { organizationId: proposedId, limit };
  });
  if (reserved.error) return { error: reserved.error };
  if ('approvedId' in reserved) return { success: true, organizationId: reserved.approvedId };
  if (!reserved.organizationId || !reserved.limit) return { error: 'The request could not be reserved for approval.' };
  const { organizationId, limit: approvedLimit } = reserved;
  if (!alreadyAssigned) await adminAuth.setCustomUserClaims(id, { ...claims, role: 'organization_admin', organizationId });

  const org = organizations.doc(organizationId);
  const audit = adminDb.collection('auditLogs').doc();
  return adminDb.runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as Registration | undefined;
    if (current?.status === 'approved') return { success: true, organizationId };
    if (current?.status !== 'approving' || current.organizationId !== organizationId) {
      return { error: 'This request is no longer reserved for approval.' };
    }
    tx.create(org, organizationAccountDocument({
      organizationId,
      name: current.name,
      status: 'active',
      adminUid: id,
      adminEmail: current.email,
      monthlyMessageLimit: approvedLimit,
      createdBy: reviewer.uid,
    }));
    tx.update(ref, { status: 'approved', reviewedBy: reviewer.uid, reviewedAt: FieldValue.serverTimestamp() });
    tx.create(audit, auditRegistration(reviewer, id, 'approved', organizationId));
    return { success: true, organizationId };
  });
}
