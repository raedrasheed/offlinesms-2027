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
import { isSupportedCountry } from 'libphonenumber-js';
import { randomInt } from 'node:crypto';
import { normalizePhoneAndCountry } from './phoneCountry';
import { loadOrgRelayCoverage } from './relayCoverage';
import { parseOtpLimits, parseRelayCaps, type OtpLimitValues, type RelayCaps } from './otpLimits';

export type RelayActionState = { error?: string; success?: boolean; code?: string; expiresAt?: number };

/** Validate/normalize ISO alpha-2 country codes (mirror of relayLogic). */
function normalizeCountryCodes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const c of input) {
    if (typeof c !== 'string') continue;
    const code = c.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code) && isSupportedCountry(code as never)) out.add(code);
  }
  return [...out].sort();
}

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
  // CSPRNG, uniform (no modulo bias). Pairing codes are one-time, 15-min bearer
  // secrets for relay enrollment.
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[randomInt(0, ALPHABET.length)];
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

/**
 * Apply an OTP-policy change and advance policyVersion in ONE transaction.
 * Queued codes from the retired generation are then cancelled by the backend's
 * generation-conditional sweep (functions: onOtpPolicyWritten + relayReaper),
 * which re-checks each job's status and generation in its own transaction —
 * this action never bulk-overwrites job documents. Codes already claimed are
 * stopped at the relay's final authorization (policyVersion mismatch).
 */
async function applyOtpPolicyChange(patch: Record<string, unknown>): Promise<number> {
  const ref = adminDb.collection('smsConfig').doc('otp');
  return adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const cur = snap.exists && typeof snap.get('policyVersion') === 'number' ? (snap.get('policyVersion') as number) : 0;
    const next = cur + 1;
    if (snap.exists) tx.update(ref, { ...patch, policyVersion: next, updatedAt: FieldValue.serverTimestamp() });
    else tx.set(ref, { policyVersion: next, updatedAt: FieldValue.serverTimestamp() });
    if (!snap.exists && Object.keys(patch).length) tx.update(ref, patch);
    return next;
  });
}

function platformOnly(session: AuthorizedSession): string | null {
  return getAdminScope(session).organizationId !== undefined
    ? 'Only a platform admin can change the OTP sender settings.' : null;
}

/** Platform setting: which org's relay sends verification SMS (smsConfig/otp).
 *  An empty id CLEARS the sender (no verification SMS can be sent). Every change
 *  bumps policyVersion and cancels queued codes bound to the old policy. */
export async function setOtpOrgAction(businessId: string): Promise<RelayActionState> {
  const session = await authorize();
  if ('error' in session) return session;
  const denied = platformOnly(session);
  if (denied) return { error: denied };
  const id = (businessId ?? '').trim() || null;
  let policyVersion = 0;
  try {
    policyVersion = await applyOtpPolicyChange({ businessId: id });
  } catch {
    return { error: 'Could not save the OTP organization.' };
  }
  await audit(id ? 'relay.otp.org.set' : 'relay.otp.org.cleared', session, id ?? 'none', { businessId: id, policyVersion });
  revalidatePath('/admin/settings');
  revalidatePath('/admin/relay');
  return { success: true };
}

export interface OtpPolicyPatch {
  enabled?: boolean;
  emergencyStop?: boolean;
  signinEnabled?: boolean;
  linkEnabled?: boolean;
}

/** Master switch, emergency stop, and per-purpose switches for verification SMS.
 *  These are runtime gates only: each purpose ALSO needs its deploy-time env
 *  flag (PHONE_AUTH_ENABLED / PHONE_LINK_ENABLED) on the functions. */
export async function setOtpPolicyAction(patch: OtpPolicyPatch): Promise<RelayActionState> {
  const session = await authorize();
  if ('error' in session) return session;
  const denied = platformOnly(session);
  if (denied) return { error: denied };
  const update: Record<string, unknown> = {};
  if (typeof patch.enabled === 'boolean') update.enabled = patch.enabled;
  if (typeof patch.emergencyStop === 'boolean') update.emergencyStop = patch.emergencyStop;
  if (typeof patch.signinEnabled === 'boolean') update['signin.enabled'] = patch.signinEnabled;
  if (typeof patch.linkEnabled === 'boolean') update['link.enabled'] = patch.linkEnabled;
  if (Object.keys(update).length === 0) return { error: 'Nothing to change.' };
  let policyVersion = 0;
  try {
    policyVersion = await applyOtpPolicyChange(update);
  } catch {
    return { error: 'Could not update the OTP policy.' };
  }
  await audit('relay.otp.policy.set', session, 'smsConfig/otp', { ...patch, policyVersion });
  revalidatePath('/admin/settings');
  return { success: true };
}

/** Send budgets for verification SMS (smsConfig/otp signin.limits, link.limits,
 *  shared). Only the fields in OTP_LIMIT_FIELDS, as whole numbers within the
 *  functions' bounds; null removes an override (the functions' default applies).
 *  Budgets are read on every request, so no policyVersion bump: queued codes
 *  stay valid. */
export async function setOtpLimitsAction(values: OtpLimitValues): Promise<RelayActionState> {
  const session = await authorize();
  if ('error' in session) return session;
  const denied = platformOnly(session);
  if (denied) return { error: denied };
  const parsed = parseOtpLimits(values);
  if ('error' in parsed) return { error: parsed.error };
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  for (const [path, v] of Object.entries(parsed.values)) update[path] = v === null ? FieldValue.delete() : v;
  const ref = adminDb.collection('smsConfig').doc('otp');
  try {
    // update() fails on a missing doc: set the sender (which creates it) first.
    await ref.update(update);
  } catch {
    return { error: 'Could not save the limits. Set the OTP organization first.' };
  }
  await audit('relay.otp.limits.set', session, 'smsConfig/otp', { limits: parsed.values });
  revalidatePath('/admin/settings');
  return { success: true };
}

/** Per-device send caps (relayDevices/{id}.caps). Every claimed job, verification
 *  codes included, counts against them. Platform admins only: the caps are the
 *  last limit on what one SIM can send. */
export async function setRelayCapsAction(deviceId: string, caps: RelayCaps): Promise<RelayActionState> {
  const session = await authorize();
  if ('error' in session) return session;
  if (getAdminScope(session).organizationId !== undefined) return { error: 'Only a platform admin can change relay caps.' };
  const parsed = parseRelayCaps(caps);
  if ('error' in parsed) return { error: parsed.error };
  const loaded = await loadDeviceScoped(session, deviceId);
  if ('error' in loaded) return { error: loaded.error };
  await loaded.ref.update({ caps: parsed.caps, updatedAt: FieldValue.serverTimestamp() });
  await audit('relay.device.caps.set', session, deviceId, { businessId: loaded.businessId, caps: parsed.caps });
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

  // Country-based relay routing: an admin test send is still a relay send and
  // must respect coverage — don't send to a country no relay serves.
  const { countryCode } = normalizePhoneAndCountry(to);
  if (!countryCode) return { error: 'Could not detect the country for this number.' };
  const coverage = await loadOrgRelayCoverage(businessId);
  if (!coverage.has(countryCode)) {
    return { error: 'No relay is available for this country (لا يوجد relay لهذه البلد).' };
  }

  const jobId = `test_${businessId}_${Date.now()}`;
  try {
    await adminDb.collection('relayJobs').doc(jobId).create({
      jobId, businessId,
      batchId: null, recipientUid: null,   // no billing batch → no Points/settlement
      phoneE164: to, recipientCountryCode: countryCode, messageBody: text,
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

export async function createRelayPairingCodeAction(
  targetBusiness?: string,
  allowedCountryCodes?: string[],
): Promise<RelayActionState> {
  const session = await authorize();
  if ('error' in session) return session;
  const businessId = targetBusinessId(session, targetBusiness);
  if (!businessId) return { error: 'Select an organization first.' };

  // Country-based routing: the admin must pick ≥1 country at activation.
  const countries = normalizeCountryCodes(allowedCountryCodes);
  if (countries.length === 0) return { error: 'Select at least one country this relay may send to.' };

  const code = genCode();
  const expiresAt = Timestamp.fromMillis(Date.now() + PAIRING_TTL_MS);
  try {
    await adminDb.collection('relayPairingCodes').doc(code).set({
      code, businessId, createdByUid: session.user.uid, label: null,
      allowedCountryCodes: countries, used: false,
      expiresAt, createdAt: FieldValue.serverTimestamp(),
    });
  } catch {
    return { error: 'Could not create a pairing code. Try again.' };
  }
  await audit('relay.pairing.created', session, businessId, { businessId, allowedCountryCodes: countries });
  revalidatePath('/admin/relay');
  return { success: true, code, expiresAt: expiresAt.toMillis() };
}

/** Edit the countries a relay may send to (admin-only; scope-checked). */
export async function setRelayCountriesAction(
  deviceId: string,
  allowedCountryCodes: string[],
  countryRoutingEnabled?: boolean,
): Promise<RelayActionState> {
  const session = await authorize();
  if ('error' in session) return session;
  const loaded = await loadDeviceScoped(session, deviceId);
  if ('error' in loaded) return { error: loaded.error };

  const next = normalizeCountryCodes(allowedCountryCodes);
  const snap = await loaded.ref.get();
  const previous = (snap.get('allowedCountryCodes') as string[] | undefined) ?? [];
  const prevEnabled = snap.get('countryRoutingEnabled') === true;
  const nextEnabled = typeof countryRoutingEnabled === 'boolean' ? countryRoutingEnabled : next.length > 0;

  await loaded.ref.update({
    allowedCountryCodes: next,
    countryRoutingEnabled: nextEnabled,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: session.user.uid,
  });

  await audit('relay.allowed_countries.updated', session, deviceId, {
    relayId: deviceId, organizationId: loaded.businessId,
    previousCountryCodes: previous, nextCountryCodes: next,
  });
  if (nextEnabled !== prevEnabled) {
    await audit(nextEnabled ? 'relay.country_routing.enabled' : 'relay.country_routing.disabled',
      session, deviceId, { relayId: deviceId, organizationId: loaded.businessId });
  }
  revalidatePath('/admin/relay');
  return { success: true };
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
