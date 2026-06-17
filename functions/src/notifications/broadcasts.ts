// Admin broadcast push notifications (Phase 28). Three callables:
//
//   estimateBroadcastAudience   — read-only count of eligible users/devices
//   createNotificationBroadcast — persist a queued broadcast
//   sendNotificationBroadcast   — resolve, dedupe-by-token, FCM-send, settle
//
// Privileges:
//   - super_admin (no organizationId claim) may target any audience type;
//   - organization_admin may target only their org or hand-picked users that
//     belong to that org. Both constraints are enforced server-side (the
//     pure canTargetAudience guard, plus a per-uid org cross-check).

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getMessaging, type Message } from 'firebase-admin/messaging';
import { writeAuditLog } from '../lib/auditLog';
import {
  validateBroadcast, canTargetAudience, buildBroadcastContent,
  maskFcmToken, SEND_BATCH_SIZE,
  type BroadcastInput, type BroadcastAudienceConfig, type BroadcastActionType,
} from './broadcastLogic';
import { isDeadTokenError, collapseKey } from './notifyLogic';
import { resolveDeviceToken, deviceHasToken, type DeviceTokenDoc } from './deviceToken';
import { buildExpoMessage, isExpoDeadTokenTicket, type ExpoPushMessage } from './expoPushLogic';
import { sendExpoPush } from './expoPush';

const REGION = 'us-central1';
const MAX_BROADCASTS_PER_HOUR = 3;
const MAX_AUDIENCE = 100_000;  // safety ceiling — refuse oversized targets

interface CallerCtx { uid: string; email: string | null; isSuper: boolean; orgId?: string }

function callerOf(request: { auth?: { uid?: string; token?: Record<string, unknown> } }): CallerCtx {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const claims = request.auth?.token ?? {};
  const role = String(claims.role ?? '');
  const adminClaim = claims.admin === true;
  const orgId = typeof claims.organizationId === 'string' ? (claims.organizationId as string) : undefined;
  // super_admin = unrestricted: legacy/bootstrap admins via `admin` claim, or
  // an explicit super_admin role; either way without an organizationId.
  const isSuper = (role === 'super_admin' || adminClaim) && !orgId;
  const isOrgAdmin = role === 'organization_admin' && !!orgId;
  if (!isSuper && !isOrgAdmin) throw new HttpsError('permission-denied', 'admins-only');
  return { uid, email: (typeof claims.email === 'string' ? (claims.email as string) : null), isSuper, orgId };
}

// ─── Audience resolution ────────────────────────────────────────────────────

interface ResolvedAudience {
  /** Distinct uids that match the audience config (sender excluded). */
  uids: string[];
  estimatedDevices: number;
}

async function uidsForAll(): Promise<string[]> {
  const snap = await getFirestore().collection('users').select().limit(MAX_AUDIENCE + 1).get();
  if (snap.size > MAX_AUDIENCE) throw new HttpsError('failed-precondition', 'audience-too-large');
  return snap.docs.map(d => d.id);
}

async function uidsForOrgs(orgIds: string[]): Promise<string[]> {
  const db = getFirestore();
  const seen = new Set<string>();
  for (const orgId of orgIds) {
    const snap = await db.collection('users').where('organizationId', '==', orgId).select().limit(MAX_AUDIENCE + 1).get();
    if (snap.size > MAX_AUDIENCE) throw new HttpsError('failed-precondition', 'audience-too-large');
    for (const d of snap.docs) seen.add(d.id);
    if (seen.size > MAX_AUDIENCE) throw new HttpsError('failed-precondition', 'audience-too-large');
  }
  return Array.from(seen);
}

async function uidsForRole(role: string): Promise<string[]> {
  const db = getFirestore();
  // Users with a role on their public doc — set when promoteAdmin / setAdminClaim
  // mirror claims to the user profile. Filtered to a safe ceiling.
  const snap = await db.collection('users').where('role', '==', role).select().limit(MAX_AUDIENCE + 1).get();
  if (snap.size > MAX_AUDIENCE) throw new HttpsError('failed-precondition', 'audience-too-large');
  return snap.docs.map(d => d.id);
}

/** For an org admin: keep only the uids that belong to their org. */
async function filterToOrg(uids: string[], orgId: string): Promise<string[]> {
  const db = getFirestore();
  // Per-uid getDoc keeps the code small and avoids the `in` 10-id limit;
  // selected_users audiences are bounded by UI to a small set.
  const snaps = await Promise.all(uids.map(u => db.collection('users').doc(u).get()));
  const out: string[] = [];
  for (const snap of snaps) {
    if (snap.exists && (snap.get('organizationId') as string | null) === orgId) out.push(snap.id);
  }
  return out;
}

/** Per-user, count enabled devices and respect their master notification setting. */
async function countEligibleDevicesForUser(uid: string): Promise<{ devices: number; eligible: boolean }> {
  const db = getFirestore();
  const [settingsSnap, devicesSnap] = await Promise.all([
    db.collection('users').doc(uid).collection('notificationSettings').doc('current').get(),
    db.collection('users').doc(uid).collection('devices').where('enabled', '==', true).get(),
  ]);
  const masterDisabled = settingsSnap.exists && settingsSnap.get('enabled') === false;
  if (masterDisabled) return { devices: 0, eligible: false };
  let devices = 0;
  // Count any device with a usable push token (FCM or Expo), not just fcmToken.
  for (const d of devicesSnap.docs) if (deviceHasToken(d.data() as DeviceTokenDoc)) devices++;
  return { devices, eligible: devices > 0 };
}

async function resolveAudience(callerOrgId: string | undefined, audience: BroadcastAudienceConfig): Promise<ResolvedAudience> {
  let uids: string[] = [];
  switch (audience.type) {
    case 'all_users':       uids = await uidsForAll(); break;
    case 'organization':    uids = await uidsForOrgs(audience.organizationIds ?? []); break;
    case 'selected_users':
    case 'single_user':     uids = Array.from(new Set(audience.userIds ?? [])); break;
    case 'role':            uids = await uidsForRole(audience.role!); break;
  }

  // Org admin: every uid must belong to their org. Reject if any don't.
  if (callerOrgId !== undefined && (audience.type === 'selected_users' || audience.type === 'single_user')) {
    const allowed = await filterToOrg(uids, callerOrgId);
    if (allowed.length !== uids.length) {
      throw new HttpsError('permission-denied', 'org-admin-org-mismatch');
    }
    uids = allowed;
  }

  // Per-user eligibility (master notification toggle + has at least one device).
  let devices = 0;
  const eligible: string[] = [];
  for (const uid of uids) {
    const { devices: d, eligible: ok } = await countEligibleDevicesForUser(uid);
    if (ok) { eligible.push(uid); devices += d; }
  }
  return { uids: eligible, estimatedDevices: devices };
}

// ─── Callable: estimate ─────────────────────────────────────────────────────

export const estimateBroadcastAudience = onCall({ region: REGION }, async (request) => {
  const me = callerOf(request);
  const audience = (request.data ?? {}).audience as BroadcastAudienceConfig | undefined;
  if (!audience || !audience.type) throw new HttpsError('invalid-argument', 'audience-required');
  const scopeErr = canTargetAudience(me.isSuper ? undefined : me.orgId, audience);
  if (scopeErr) throw new HttpsError('permission-denied', scopeErr);

  const { uids, estimatedDevices } = await resolveAudience(me.isSuper ? undefined : me.orgId, audience);
  return { estimatedUsers: uids.length, estimatedDevices };
});

// ─── Callable: create (queued) ──────────────────────────────────────────────

export const createNotificationBroadcast = onCall({ region: REGION }, async (request) => {
  const me = callerOf(request);
  const data = (request.data ?? {}) as BroadcastInput;
  const v = validateBroadcast(data);
  if (v) throw new HttpsError('invalid-argument', v);
  const scopeErr = canTargetAudience(me.isSuper ? undefined : me.orgId, data.audience);
  if (scopeErr) throw new HttpsError('permission-denied', scopeErr);

  const db = getFirestore();

  // Rate limit: at most N broadcasts per hour per admin.
  const sinceMs = Date.now() - 60 * 60 * 1000;
  const recent = await db.collection('notificationBroadcasts')
    .where('createdByUid', '==', me.uid)
    .where('createdAt', '>=', Timestamp.fromMillis(sinceMs))
    .count().get();
  if (recent.data().count >= MAX_BROADCASTS_PER_HOUR) {
    throw new HttpsError('resource-exhausted', 'broadcast-rate-limit');
  }

  // Pre-compute estimate so the UI can show it on the listing.
  const { uids, estimatedDevices } = await resolveAudience(me.isSuper ? undefined : me.orgId, data.audience);

  const ref = db.collection('notificationBroadcasts').doc();
  await ref.set({
    broadcastId:      ref.id,
    title:            data.title.trim(),
    body:             data.body.trim(),
    imageUrl:         data.imageUrl ?? null,
    actionType:       data.actionType,
    actionTarget:     data.actionTarget ?? null,
    audience:         data.audience,
    status:           'queued',
    estimatedUsers:   uids.length,
    estimatedDevices,
    sentDevices:      0,
    failedDevices:    0,
    invalidTokens:    0,
    createdByUid:     me.uid,
    createdAt:        FieldValue.serverTimestamp(),
    updatedAt:        FieldValue.serverTimestamp(),
  });

  void writeAuditLog({
    action: 'broadcast.created', actor: { uid: me.uid, email: me.email },
    target: { type: 'broadcast', id: ref.id }, result: 'success',
    metadata: { audienceType: data.audience.type, estimatedUsers: uids.length, estimatedDevices },
  }).catch(() => {});

  return { broadcastId: ref.id, estimatedUsers: uids.length, estimatedDevices };
});

// ─── Callable: send ─────────────────────────────────────────────────────────

export const sendNotificationBroadcast = onCall({ region: REGION, timeoutSeconds: 540 }, async (request) => {
  const me = callerOf(request);
  const data = (request.data ?? {}) as { broadcastId?: unknown };
  if (typeof data.broadcastId !== 'string' || !data.broadcastId) {
    throw new HttpsError('invalid-argument', 'broadcastId-required');
  }
  const db = getFirestore();
  const ref = db.collection('notificationBroadcasts').doc(data.broadcastId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'broadcast-not-found');
  const b = snap.data() as BroadcastInput & { status?: string; createdByUid?: string };

  // org_admin may only send their own queued broadcasts.
  if (!me.isSuper && b.createdByUid !== me.uid) throw new HttpsError('permission-denied', 'not-creator');
  if (b.status !== 'queued') throw new HttpsError('failed-precondition', `status-not-queued:${b.status}`);

  const scopeErr = canTargetAudience(me.isSuper ? undefined : me.orgId, b.audience);
  if (scopeErr) throw new HttpsError('permission-denied', scopeErr);

  await ref.update({ status: 'sending', sentAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });

  const { display, data: payload } = buildBroadcastContent(ref.id, b);

  let sent = 0, failed = 0, invalid = 0;
  const cleanups: Promise<unknown>[] = [];
  try {
    // Resolve audience again to pick up any since-disabled tokens.
    const { uids } = await resolveAudience(me.isSuper ? undefined : me.orgId, b.audience);

    // Collect (provider, uid, deviceId, token) targets; dedupe by TOKEN so two
    // devices sharing the same token (rare) receive once. Android = native FCM,
    // iOS = Expo push token.
    interface Target { uid: string; deviceId: string; token: string; provider: 'fcm' | 'expo' }
    const fcmTargets: Target[] = [];
    const expoTargets: Target[] = [];
    const seenTokens = new Set<string>();
    for (const uid of uids) {
      const devs = await db.collection('users').doc(uid).collection('devices').where('enabled', '==', true).get();
      for (const dev of devs.docs) {
        const resolved = resolveDeviceToken(dev.data() as DeviceTokenDoc);
        if (!resolved || seenTokens.has(resolved.token)) continue;
        seenTokens.add(resolved.token);
        (resolved.provider === 'expo' ? expoTargets : fcmTargets)
          .push({ uid, deviceId: dev.id, token: resolved.token, provider: resolved.provider });
      }
    }

    const tag = collapseKey(`broadcast_${ref.id}`);

    const recordDelivery = (t: Target, status: 'sent' | 'invalid_token' | 'failed', errorCode?: string) =>
      ref.collection('deliveries').doc(`${t.uid}_${t.deviceId}`).set({
        uid: t.uid, deviceId: t.deviceId, provider: t.provider, fcmTokenMasked: maskFcmToken(t.token),
        status, ...(errorCode ? { errorCode } : {}), sentAt: FieldValue.serverTimestamp(),
      });
    const tally = (r: 'sent' | 'invalid' | 'failed') => {
      if (r === 'sent') sent++;
      else if (r === 'invalid') { failed++; invalid++; }
      else failed++;
    };
    const checkpoint = () => ref.update({ sentDevices: sent, failedDevices: failed, invalidTokens: invalid, updatedAt: FieldValue.serverTimestamp() });

    // ── Android: native FCM via firebase-admin (behavior unchanged) ──
    const messaging = getMessaging();
    const fcmBatches: Target[][] = [];
    for (let i = 0; i < fcmTargets.length; i += SEND_BATCH_SIZE) fcmBatches.push(fcmTargets.slice(i, i + SEND_BATCH_SIZE));
    for (const batch of fcmBatches) {
      const responses = await Promise.all(batch.map(async (t) => {
        const msg: Message = {
          token: t.token,
          notification: { title: display.title, body: display.body, ...(display.imageUrl ? { imageUrl: display.imageUrl } : {}) },
          data: payload as unknown as Record<string, string>,
          android: {
            collapseKey: tag,
            priority: 'high',
            notification: { tag, defaultSound: true },
          },
          apns: {
            headers: { 'apns-collapse-id': tag },
            payload: { aps: { sound: 'default' } },
          },
        };
        try {
          await messaging.send(msg);
          await recordDelivery(t, 'sent');
          return 'sent' as const;
        } catch (e: any) {
          const code = e?.errorInfo?.code ?? e?.code;
          const dead = isDeadTokenError(code);
          await recordDelivery(t, dead ? 'invalid_token' : 'failed', code ?? 'unknown');
          if (dead) {
            const devRef = db.collection('users').doc(t.uid).collection('devices').doc(t.deviceId);
            cleanups.push(devRef.set({ enabled: false, disabledAt: FieldValue.serverTimestamp(), disabledReason: code }, { merge: true }));
          }
          return dead ? 'invalid' as const : 'failed' as const;
        }
      }));
      for (const r of responses) tally(r);
      await checkpoint();
    }

    // ── iOS: Expo push service (APNs) ──
    const expoBatches: Target[][] = [];
    for (let i = 0; i < expoTargets.length; i += SEND_BATCH_SIZE) expoBatches.push(expoTargets.slice(i, i + SEND_BATCH_SIZE));
    for (const batch of expoBatches) {
      const messages: ExpoPushMessage[] = batch.map(t => buildExpoMessage(t.token, {
        title: display.title, body: display.body,
        data: payload as unknown as Record<string, string>,
        conversationId: ref.id,
      }));
      const tickets = await sendExpoPush(messages);
      for (let i = 0; i < batch.length; i++) {
        const t = batch[i];
        const ticket = tickets[i];
        if (ticket?.status === 'ok') { await recordDelivery(t, 'sent'); tally('sent'); continue; }
        const dead = isExpoDeadTokenTicket(ticket);
        await recordDelivery(t, dead ? 'invalid_token' : 'failed', ticket?.details?.error ?? ticket?.message ?? 'unknown');
        if (dead) {
          const devRef = db.collection('users').doc(t.uid).collection('devices').doc(t.deviceId);
          cleanups.push(devRef.set({ enabled: false, disabledAt: FieldValue.serverTimestamp(), disabledReason: 'DeviceNotRegistered' }, { merge: true }));
        }
        tally(dead ? 'invalid' : 'failed');
      }
      await checkpoint();
    }

    await Promise.allSettled(cleanups);
    await ref.update({ status: 'sent', updatedAt: FieldValue.serverTimestamp() });

    void writeAuditLog({
      action: 'broadcast.sent', actor: { uid: me.uid, email: me.email },
      target: { type: 'broadcast', id: ref.id }, result: 'success',
      metadata: { sent, failed, invalidTokens: invalid, audienceType: b.audience.type },
    }).catch(() => {});

    return { ok: true, sent, failed, invalidTokens: invalid };
  } catch (e: any) {
    const msg = String(e?.message ?? e?.code ?? 'unknown');
    await ref.update({ status: 'failed', error: msg.slice(0, 200), updatedAt: FieldValue.serverTimestamp() });
    void writeAuditLog({
      action: 'broadcast.failed', actor: { uid: me.uid, email: me.email },
      target: { type: 'broadcast', id: ref.id }, result: 'failure',
      metadata: { error: msg.slice(0, 200) },
    }).catch(() => {});
    throw e instanceof HttpsError ? e : new HttpsError('internal', 'send-failed');
  }
});

export { type BroadcastActionType };
