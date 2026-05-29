'use server';

// Phase 24 — SMS Relay admin server actions.
//
// Server-side (Admin SDK), mirroring orgActions.ts. relayDevices/relayJobs are
// Admin-only at the rules layer, so all mutations flow through here with an
// explicit role + organization-scope check. organization_admin may act only on
// its own organization; super_admin (and legacy/bootstrap) on any.

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb, adminAuth } from './firebase-admin';
import { verifySession, type SessionResult } from './session';
import { canDo } from './adminPermissions';
import { getAdminScope, canViewOrganization } from './adminScope';

export type RelayActionState = { error?: string; success?: boolean; code?: string; expiresAt?: number };

const PAIRING_TTL_MS = 15 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

type AuthorizedSession = SessionResult & { state: 'authorized' };

async function authorize(): Promise<AuthorizedSession | { error: string }> {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') return { error: 'Not authenticated.' };
  if (!canDo(session.role, 'manage:relay')) return { error: 'You do not have relay management access.' };
  return session;
}

async function audit(action: string, actor: AuthorizedSession, targetId: string, meta: Record<string, unknown>) {
  try {
    await adminDb.collection('auditLogs').add({
      action, actorUid: actor.user.uid, actorEmail: actor.user.email ?? null,
      targetType: 'relayDevice', targetId, result: 'success', metadata: meta,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch { /* soft-fail */ }
}

function genCode(): string {
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

/** organization_admin → own org; unrestricted role → must pass a businessId. */
function targetBusinessId(session: AuthorizedSession, requested?: string): string | null {
  const scope = getAdminScope(session);
  if (scope.organizationId) return scope.organizationId;
  return requested && requested.trim() ? requested.trim() : null;
}

const UI_TO_BACKEND_MODE: Record<string, string> = {
  http: 'http', relay: 'relay', hybrid: 'relay_with_http_fallback',
};

export async function setRelayModeAction(mode: 'http' | 'relay' | 'hybrid', targetBusiness?: string): Promise<RelayActionState> {
  const session = await authorize();
  if ('error' in session) return session;
  const backend = UI_TO_BACKEND_MODE[mode];
  if (!backend) return { error: 'Invalid mode.' };
  const businessId = targetBusinessId(session, targetBusiness);
  if (!businessId) return { error: 'Select an organization first.' };
  try {
    await adminDb.collection('smsConfig').doc('providers').set(
      { byBusiness: { [businessId]: backend } }, { merge: true },
    );
  } catch {
    return { error: 'Could not update relay mode.' };
  }
  await audit('relay.mode.set', session, businessId, { businessId, mode: backend });
  revalidatePath('/admin/relay');
  return { success: true };
}

const E164 = /^\+[1-9]\d{6,14}$/;

/** Platform setting: which org's relay sends sign-in OTP (smsConfig/otp). Only
 *  unrestricted (super/legacy/bootstrap) admins may set it — it's global. */
export async function setOtpOrgAction(businessId: string): Promise<RelayActionState> {
  const session = await authorize();
  if ('error' in session) return session;
  if (getAdminScope(session).organizationId !== undefined) {
    return { error: 'Only a platform admin can set the default OTP organization.' };
  }
  if (!businessId.trim()) return { error: 'Select an organization.' };
  try {
    await adminDb.collection('smsConfig').doc('otp').set(
      { businessId: businessId.trim(), updatedAt: FieldValue.serverTimestamp() }, { merge: true },
    );
  } catch {
    return { error: 'Could not save the OTP organization.' };
  }
  await audit('relay.otp.org.set', session, businessId.trim(), { businessId: businessId.trim() });
  revalidatePath('/admin/relay');
  return { success: true };
}

export async function sendRelayTestAction(phoneE164: string, body: string, targetBusiness?: string): Promise<RelayActionState> {
  const session = await authorize();
  if ('error' in session) return session;
  const businessId = targetBusinessId(session, targetBusiness);
  if (!businessId) return { error: 'Select an organization first.' };

  const to = (phoneE164 ?? '').trim();
  const text = (body ?? '').trim();
  if (!E164.test(to)) return { error: 'Enter a phone number in E.164 format, e.g. +972591234567.' };
  if (text.length === 0) return { error: 'Message is required.' };
  if (text.length > 300) return { error: 'Message must be 300 characters or less.' };

  const jobId = `test_${businessId}_${Date.now()}`;
  try {
    await adminDb.collection('relayJobs').doc(jobId).create({
      jobId, businessId,
      batchId: null, recipientUid: null,   // no billing batch → no Points/settlement
      phoneE164: to, messageBody: text,
      assignedDeviceId: null, assignedSimSubscriptionId: null,
      status: 'queued', attempts: 0, maxAttempts: 3,
      leaseOwnerDeviceId: null, leaseExpiresAt: null, nextAttemptAt: null,
      traceId: jobId,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
  } catch {
    return { error: 'Could not queue the message. Try again.' };
  }
  // Audit without the recipient number / body (redacted by the logger anyway).
  await audit('relay.test.queued', session, businessId, { businessId, jobId });
  revalidatePath('/admin/relay');
  return { success: true };
}

export async function createRelayPairingCodeAction(targetBusiness?: string): Promise<RelayActionState> {
  const session = await authorize();
  if ('error' in session) return session;
  const businessId = targetBusinessId(session, targetBusiness);
  if (!businessId) return { error: 'Select an organization first.' };

  const code = genCode();
  const expiresAt = Timestamp.fromMillis(Date.now() + PAIRING_TTL_MS);
  try {
    await adminDb.collection('relayPairingCodes').doc(code).set({
      code, businessId, createdByUid: session.user.uid, label: null, used: false,
      expiresAt, createdAt: FieldValue.serverTimestamp(),
    });
  } catch {
    return { error: 'Could not create a pairing code. Try again.' };
  }
  await audit('relay.pairing.created', session, businessId, { businessId });
  revalidatePath('/admin/relay');
  return { success: true, code, expiresAt: expiresAt.toMillis() };
}

async function loadDeviceScoped(session: AuthorizedSession, deviceId: string) {
  const ref = adminDb.collection('relayDevices').doc(deviceId);
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Device not found.' as const };
  const businessId = snap.get('businessId') as string;
  if (!canViewOrganization(session, businessId)) return { error: 'Cross-organization access denied.' as const };
  return { ref, businessId };
}

export async function setRelayDeviceStatusAction(deviceId: string, status: 'active' | 'paused'): Promise<RelayActionState> {
  const session = await authorize();
  if ('error' in session) return session;
  if (status !== 'active' && status !== 'paused') return { error: 'Invalid status.' };
  const loaded = await loadDeviceScoped(session, deviceId);
  if ('error' in loaded) return { error: loaded.error };
  await loaded.ref.update({ status, updatedAt: FieldValue.serverTimestamp() });
  await audit(status === 'paused' ? 'relay.device.paused' : 'relay.device.resumed', session, deviceId, { businessId: loaded.businessId });
  revalidatePath('/admin/relay');
  return { success: true };
}

export async function revokeRelayDeviceAction(deviceId: string): Promise<RelayActionState> {
  const session = await authorize();
  if ('error' in session) return session;
  const loaded = await loadDeviceScoped(session, deviceId);
  if ('error' in loaded) return { error: loaded.error };
  await loaded.ref.update({ status: 'revoked', revokedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  try { await adminAuth.revokeRefreshTokens(deviceId); } catch { /* best-effort */ }
  await audit('relay.device.revoked', session, deviceId, { businessId: loaded.businessId });
  revalidatePath('/admin/relay');
  return { success: true };
}
