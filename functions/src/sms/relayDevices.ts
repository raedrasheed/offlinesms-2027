// Relay device lifecycle callables (Phase 24).
//
//   createRelayPairingCode — dashboard (org_admin/super_admin) → one-time code
//   enrollRelayDevice      — relay app (UNAUTH; authenticated by the code) →
//                            creates the device + returns a Firebase custom token
//   relayHeartbeat         — device (custom-token auth) → liveness/health
//   revokeRelayDevice      — dashboard → disable a device
//
// Business rule: relay is business-only. businessId = caller's organizationId
// claim; only organization_admin (own org) or super_admin may manage devices.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { writeAuditLog } from '../lib/auditLog';
import {
  generatePairingCode, isPairingCodeUsable, resolveBusinessId, canManageBusiness,
  normalizeCountryCodes, PAIRING_CODE_TTL_MS, sanitizeTelemetryCount,
} from './relayLogic';
import { DEFAULT_RELAY_CAPS } from './relayTypes';

const REGION = 'us-central1';

export const createRelayPairingCode = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const token = request.auth?.token as Record<string, unknown> | undefined;
  const data = (request.data ?? {}) as { businessId?: string; label?: string; allowedCountryCodes?: unknown };

  const businessId = resolveBusinessId(token, data.businessId);
  if (!businessId) throw new HttpsError('permission-denied', 'relay-business-only');

  // Country-based routing: the admin must pick the countries this relay may send
  // to during activation. Activation is blocked if none are selected.
  const allowedCountryCodes = normalizeCountryCodes(data.allowedCountryCodes);
  if (allowedCountryCodes.length === 0) {
    throw new HttpsError('invalid-argument', 'relay-countries-required');
  }

  const db = getFirestore();
  const code = generatePairingCode();
  const expiresAt = Timestamp.fromMillis(Date.now() + PAIRING_CODE_TTL_MS);
  await db.collection('relayPairingCodes').doc(code).set({
    code,
    businessId,
    createdByUid: uid,
    label: typeof data.label === 'string' ? data.label.slice(0, 80) : null,
    allowedCountryCodes,           // applied to the device at enrollment
    used: false,
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
  });

  await writeAuditLog({
    action: 'relay.pairing.created', actor: { uid }, result: 'success',
    target: { type: 'relayBusiness', id: businessId },
    metadata: { businessId, allowedCountryCodes },
  });

  return { code, expiresAt: expiresAt.toMillis(), businessId, allowedCountryCodes };
});

export const enrollRelayDevice = onCall({ region: REGION }, async (request) => {
  // Intentionally callable without Firebase auth — the device has no identity
  // yet. It is authenticated by the one-time, business-scoped pairing code.
  // TODO(security): enforce App Check once the relay app ships an attestation.
  const data = (request.data ?? {}) as {
    pairingCode?: string; deviceLabel?: string; fcmToken?: string; appVersion?: string;
    androidInfo?: { manufacturer?: string; model?: string; androidVersion?: string };
    simInfo?: Array<{ subscriptionId: number; slotIndex?: number; carrierName?: string }>;
  };
  if (typeof data.pairingCode !== 'string' || !data.pairingCode) {
    throw new HttpsError('invalid-argument', 'pairingCode-required');
  }

  const db = getFirestore();
  const codeRef = db.collection('relayPairingCodes').doc(data.pairingCode);
  const deviceRef = db.collection('relayDevices').doc();
  const deviceId = deviceRef.id;

  // Validate the code (pre-read) and mint the device token BEFORE persisting
  // anything, so a token-signing failure leaves no orphan device + the code
  // unconsumed. The transaction below re-validates to close the race.
  const preSnap = await codeRef.get();
  if (!preSnap.exists) throw new HttpsError('not-found', 'pairing-code-invalid');
  const pre = preSnap.data() as {
    businessId: string; createdByUid: string; used?: boolean; expiresAt?: Timestamp;
    allowedCountryCodes?: string[];
  };
  if (!isPairingCodeUsable({ used: pre.used, expiresAtMs: pre.expiresAt?.toMillis?.() ?? 0 }, Date.now())) {
    throw new HttpsError('failed-precondition', 'pairing-code-expired-or-used');
  }
  const businessId = pre.businessId;
  // Countries chosen by the admin at code creation. Pre-feature codes won't have
  // them → device enrolls BLOCKED (countryRoutingEnabled:false) until configured.
  const allowedCountryCodes = normalizeCountryCodes(pre.allowedCountryCodes);

  // Mint first — if this throws (e.g. missing Token Creator role), nothing was written.
  const customToken = await getAuth().createCustomToken(deviceId, {
    relayDevice: true, deviceId, businessId,
  });

  // Now consume the code + create the device atomically (re-check usability).
  await db.runTransaction(async tx => {
    const snap = await tx.get(codeRef);
    if (!snap.exists) throw new HttpsError('not-found', 'pairing-code-invalid');
    const c = snap.data() as { used?: boolean; expiresAt?: Timestamp };
    if (!isPairingCodeUsable({ used: c.used, expiresAtMs: c.expiresAt?.toMillis?.() ?? 0 }, Date.now())) {
      throw new HttpsError('failed-precondition', 'pairing-code-expired-or-used');
    }
    tx.update(codeRef, { used: true, usedAt: FieldValue.serverTimestamp(), deviceId });
    tx.set(deviceRef, {
      deviceId,
      businessId,
      ownerUid:       pre.createdByUid,
      label:          typeof data.deviceLabel === 'string' ? data.deviceLabel.slice(0, 80) : 'Relay device',
      status:         'active',
      fcmToken:       typeof data.fcmToken === 'string' ? data.fcmToken : null,
      appVersion:     typeof data.appVersion === 'string' ? data.appVersion : null,
      androidVersion: data.androidInfo?.androidVersion ?? null,
      manufacturer:   data.androidInfo?.manufacturer ?? null,
      model:          data.androidInfo?.model ?? null,
      simInfo:        Array.isArray(data.simInfo) ? data.simInfo.slice(0, 4) : [],
      caps:           DEFAULT_RELAY_CAPS,
      counters:       { sentToday: 0, failedToday: 0, deliveredToday: 0 },
      allowedCountryCodes,
      countryRoutingEnabled: allowedCountryCodes.length > 0,
      lastHeartbeatAt: FieldValue.serverTimestamp(),
      lastSeenAt:      FieldValue.serverTimestamp(),
      createdAt:       FieldValue.serverTimestamp(),
      updatedAt:       FieldValue.serverTimestamp(),
      updatedBy:       pre.createdByUid,
    });
  });

  await writeAuditLog({
    action: 'relay.device.enrolled', actor: { uid: deviceId },
    target: { type: 'relayDevice', id: deviceId }, result: 'success',
    metadata: { businessId },
  });

  return { deviceId, businessId, customToken };
});

export const relayHeartbeat = onCall({ region: REGION }, async (request) => {
  const token = request.auth?.token as Record<string, unknown> | undefined;
  const data = (request.data ?? {}) as {
    deviceId?: string; fcmToken?: string; appVersion?: string;
    simInfo?: unknown[]; queueDepth?: number; sentToday?: number;
    failedToday?: number; lastError?: string;
  };
  if (token?.relayDevice !== true || typeof data.deviceId !== 'string' || token.deviceId !== data.deviceId) {
    throw new HttpsError('permission-denied', 'not-a-relay-device');
  }

  const db = getFirestore();
  const ref = db.collection('relayDevices').doc(data.deviceId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'device-not-found');
  if (snap.get('status') === 'revoked') throw new HttpsError('permission-denied', 'device-revoked');

  const wasOffline = snap.get('status') === 'offline';
  const patch: Record<string, unknown> = {
    lastHeartbeatAt: FieldValue.serverTimestamp(),
    lastSeenAt:      FieldValue.serverTimestamp(),
    updatedAt:       FieldValue.serverTimestamp(),
  };
  if (typeof data.fcmToken === 'string')   patch.fcmToken = data.fcmToken;
  if (typeof data.appVersion === 'string') patch.appVersion = data.appVersion;
  if (Array.isArray(data.simInfo))         patch.simInfo = data.simInfo.slice(0, 4);
  // Client-reported numbers are TELEMETRY only, stored apart from the server-
  // owned delivery metrics (counters.*) and send-capacity reservations (usage).
  // Older relay builds always sent sentToday=0/failedToday=0 here, which used to
  // overwrite counters.sentToday and reopen the daily cap.
  const telemetry: Record<string, unknown> = { reportedAt: FieldValue.serverTimestamp() };
  for (const k of ['sentToday', 'failedToday', 'queueDepth'] as const) {
    const v = sanitizeTelemetryCount((data as Record<string, unknown>)[k]);
    if (v !== null) telemetry[k] = v;
  }
  patch.telemetry = telemetry;
  // Revive an 'offline' device that's heartbeating again (don't override pause).
  if (wasOffline) patch.status = 'active';
  await ref.update(patch);

  // Audit only meaningful transitions, not every heartbeat.
  if (wasOffline) {
    await writeAuditLog({
      action: 'relay.device.online', actor: { uid: data.deviceId },
      target: { type: 'relayDevice', id: data.deviceId }, result: 'success',
    });
  }
  return { ok: true };
});

export const revokeRelayDevice = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const token = request.auth?.token as Record<string, unknown> | undefined;
  const data = (request.data ?? {}) as { deviceId?: string };
  if (typeof data.deviceId !== 'string' || !data.deviceId) {
    throw new HttpsError('invalid-argument', 'deviceId-required');
  }

  const db = getFirestore();
  const ref = db.collection('relayDevices').doc(data.deviceId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'device-not-found');
  if (!canManageBusiness(token, snap.get('businessId'))) {
    throw new HttpsError('permission-denied', 'not-your-business');
  }

  await ref.update({ status: 'revoked', revokedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  try { await getAuth().revokeRefreshTokens(data.deviceId); } catch { /* best-effort */ }

  await writeAuditLog({
    action: 'relay.device.revoked', actor: { uid },
    target: { type: 'relayDevice', id: data.deviceId }, result: 'success',
    metadata: { businessId: snap.get('businessId') },
  });
  return { ok: true };
});

/**
 * setRelayCountries — admin edits the countries a relay may send to. Admin-only
 * (org_admin own-business / super_admin); relay devices CANNOT call this (no
 * org-admin role on their custom token). Server-side enforcement: validates ISO
 * codes and writes the audit trail. This is the only write path for the routing
 * fields besides enrollment.
 */
export const setRelayCountries = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const token = request.auth?.token as Record<string, unknown> | undefined;
  const data = (request.data ?? {}) as {
    deviceId?: string; allowedCountryCodes?: unknown; countryRoutingEnabled?: unknown;
  };
  if (typeof data.deviceId !== 'string' || !data.deviceId) {
    throw new HttpsError('invalid-argument', 'deviceId-required');
  }

  const nextCountryCodes = normalizeCountryCodes(data.allowedCountryCodes);

  const db = getFirestore();
  const ref = db.collection('relayDevices').doc(data.deviceId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'device-not-found');
  const businessId = snap.get('businessId') as string;
  if (!canManageBusiness(token, businessId)) {
    throw new HttpsError('permission-denied', 'not-your-business');
  }

  const previousCountryCodes = (snap.get('allowedCountryCodes') as string[] | undefined) ?? [];
  const prevEnabled = snap.get('countryRoutingEnabled') === true;
  // Routing is enabled iff explicitly requested, else auto-on when ≥1 country.
  const nextEnabled = typeof data.countryRoutingEnabled === 'boolean'
    ? data.countryRoutingEnabled
    : nextCountryCodes.length > 0;

  await ref.update({
    allowedCountryCodes: nextCountryCodes,
    countryRoutingEnabled: nextEnabled,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: uid,
  });

  await writeAuditLog({
    action: 'relay.allowed_countries.updated', actor: { uid },
    target: { type: 'relayDevice', id: data.deviceId }, result: 'success',
    metadata: {
      relayId: data.deviceId, organizationId: businessId,
      previousCountryCodes, nextCountryCodes,
    },
  });
  if (nextEnabled !== prevEnabled) {
    await writeAuditLog({
      action: nextEnabled ? 'relay.country_routing.enabled' : 'relay.country_routing.disabled',
      actor: { uid }, target: { type: 'relayDevice', id: data.deviceId }, result: 'success',
      metadata: { relayId: data.deviceId, organizationId: businessId },
    });
  }

  return { ok: true, allowedCountryCodes: nextCountryCodes, countryRoutingEnabled: nextEnabled };
});
