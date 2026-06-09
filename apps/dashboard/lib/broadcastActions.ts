'use server';

// Phase 28 — admin broadcast push notifications (server actions).
//
// Mirrors the functions/src/notifications/broadcasts.ts callable trio
// (estimate / create / send) but runs server-side from the dashboard via the
// Admin SDK + the session cookie, so the dashboard never needs to mint a
// custom ID token to call its own backend. Pure validation + scope logic is
// imported from broadcastLogic.ts (mirror of the functions module).

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getMessaging, type Message } from 'firebase-admin/messaging';
import { adminDb } from './firebase-admin';
import { verifySession, type SessionResult } from './session';
import { canDo } from './adminPermissions';
import { getAdminScope } from './adminScope';
import {
  validateBroadcast, canTargetAudience, buildBroadcastContent,
  maskFcmToken, SEND_BATCH_SIZE,
  type BroadcastInput, type BroadcastAudienceConfig,
} from './broadcastLogic';

export type BroadcastActionState = { error?: string; success?: boolean };

const MAX_BROADCASTS_PER_HOUR = 3;
const MAX_AUDIENCE = 100_000;
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

type Authorized = SessionResult & { state: 'authorized' };

async function authorize(needManage = false): Promise<Authorized | { error: string }> {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') return { error: 'Not authenticated.' };
  const cap = needManage ? 'manage:broadcast_notifications' : 'view:broadcast_notifications';
  if (!canDo(session.role, cap)) return { error: 'Not authorized for broadcasts.' };
  return session;
}

function callerOrgId(session: Authorized): string | undefined {
  return getAdminScope(session).organizationId;   // undefined for super_admin
}

// ─── Audience resolution (mirrors functions/src/notifications/broadcasts.ts) ─

async function uidsForAll(): Promise<string[]> {
  const snap = await adminDb.collection('users').select().limit(MAX_AUDIENCE + 1).get();
  if (snap.size > MAX_AUDIENCE) throw new Error('audience-too-large');
  return snap.docs.map(d => d.id);
}

async function uidsForOrgs(orgIds: string[]): Promise<string[]> {
  const seen = new Set<string>();
  for (const orgId of orgIds) {
    const snap = await adminDb.collection('users').where('organizationId', '==', orgId).select().limit(MAX_AUDIENCE + 1).get();
    if (snap.size > MAX_AUDIENCE) throw new Error('audience-too-large');
    for (const d of snap.docs) seen.add(d.id);
  }
  return Array.from(seen);
}

async function uidsForRole(role: string): Promise<string[]> {
  const snap = await adminDb.collection('users').where('role', '==', role).select().limit(MAX_AUDIENCE + 1).get();
  if (snap.size > MAX_AUDIENCE) throw new Error('audience-too-large');
  return snap.docs.map(d => d.id);
}

async function filterToOrg(uids: string[], orgId: string): Promise<string[]> {
  const snaps = await Promise.all(uids.map(u => adminDb.collection('users').doc(u).get()));
  const out: string[] = [];
  for (const snap of snaps) {
    if (snap.exists && (snap.get('organizationId') as string | null) === orgId) out.push(snap.id);
  }
  return out;
}

async function countEligibleDevicesForUser(uid: string): Promise<{ devices: number; eligible: boolean }> {
  const [settings, devices] = await Promise.all([
    adminDb.collection('users').doc(uid).collection('notificationSettings').doc('current').get(),
    adminDb.collection('users').doc(uid).collection('devices').where('enabled', '==', true).get(),
  ]);
  if (settings.exists && settings.get('enabled') === false) return { devices: 0, eligible: false };
  let count = 0;
  for (const d of devices.docs) if (d.get('fcmToken')) count++;
  return { devices: count, eligible: count > 0 };
}

interface Resolved { uids: string[]; estimatedDevices: number }

async function resolveAudience(orgId: string | undefined, audience: BroadcastAudienceConfig): Promise<Resolved> {
  let uids: string[] = [];
  switch (audience.type) {
    case 'all_users':       uids = await uidsForAll(); break;
    case 'organization':    uids = await uidsForOrgs(audience.organizationIds ?? []); break;
    case 'selected_users':
    case 'single_user':     uids = Array.from(new Set(audience.userIds ?? [])); break;
    case 'role':            uids = await uidsForRole(audience.role!); break;
  }
  if (orgId !== undefined && (audience.type === 'selected_users' || audience.type === 'single_user')) {
    const allowed = await filterToOrg(uids, orgId);
    if (allowed.length !== uids.length) throw new Error('org-admin-org-mismatch');
    uids = allowed;
  }
  let devices = 0;
  const eligible: string[] = [];
  for (const uid of uids) {
    const { devices: d, eligible: ok } = await countEligibleDevicesForUser(uid);
    if (ok) { eligible.push(uid); devices += d; }
  }
  return { uids: eligible, estimatedDevices: devices };
}

// ─── Action: estimate ──────────────────────────────────────────────────────

export async function estimateAudience(audience: BroadcastAudienceConfig): Promise<{ estimatedUsers?: number; estimatedDevices?: number; error?: string }> {
  const session = await authorize();
  if ('error' in session) return { error: session.error };
  const scopeErr = canTargetAudience(callerOrgId(session), audience);
  if (scopeErr) return { error: scopeErr };
  try {
    const { uids, estimatedDevices } = await resolveAudience(callerOrgId(session), audience);
    return { estimatedUsers: uids.length, estimatedDevices };
  } catch (e: any) {
    return { error: e?.message ?? 'estimate-failed' };
  }
}

// ─── Action: create + send (single user-flow step from the dashboard) ──────

export async function createAndSendBroadcast(input: BroadcastInput): Promise<BroadcastActionState & { broadcastId?: string; sent?: number; failed?: number; invalidTokens?: number }> {
  const session = await authorize(/*needManage*/ true);
  if ('error' in session) return { error: session.error };
  const v = validateBroadcast(input);
  if (v) return { error: v };
  const orgId = callerOrgId(session);
  const scopeErr = canTargetAudience(orgId, input.audience);
  if (scopeErr) return { error: scopeErr };

  // Rate limit (3/hour per admin).
  const sinceMs = Date.now() - 60 * 60 * 1000;
  const recent = await adminDb.collection('notificationBroadcasts')
    .where('createdByUid', '==', session.user.uid)
    .where('createdAt', '>=', Timestamp.fromMillis(sinceMs))
    .count().get();
  if (recent.data().count >= MAX_BROADCASTS_PER_HOUR) return { error: 'broadcast-rate-limit' };

  // Resolve audience (may throw 'audience-too-large' / 'org-admin-org-mismatch').
  let resolved: Resolved;
  try { resolved = await resolveAudience(orgId, input.audience); }
  catch (e: any) { return { error: e?.message ?? 'resolve-failed' }; }

  // Persist the queued broadcast.
  const ref = adminDb.collection('notificationBroadcasts').doc();
  await ref.set({
    broadcastId: ref.id, title: input.title.trim(), body: input.body.trim(),
    imageUrl: input.imageUrl ?? null, actionType: input.actionType,
    actionTarget: input.actionTarget ?? null, audience: input.audience,
    status: 'sending',
    estimatedUsers: resolved.uids.length, estimatedDevices: resolved.estimatedDevices,
    sentDevices: 0, failedDevices: 0, invalidTokens: 0,
    createdByUid: session.user.uid, createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(), sentAt: FieldValue.serverTimestamp(),
  });

  // Collect (uid, deviceId, token) targets and dedupe by token.
  interface Target { uid: string; deviceId: string; token: string }
  const targets: Target[] = [];
  const seenTokens = new Set<string>();
  for (const uid of resolved.uids) {
    const devs = await adminDb.collection('users').doc(uid).collection('devices').where('enabled', '==', true).get();
    for (const dev of devs.docs) {
      const token = dev.get('fcmToken') as string | undefined;
      if (!token || seenTokens.has(token)) continue;
      seenTokens.add(token);
      targets.push({ uid, deviceId: dev.id, token });
    }
  }

  const { display, data: payload } = buildBroadcastContent(ref.id, input);
  const messaging = getMessaging();
  const cleanups: Promise<unknown>[] = [];
  let sent = 0, failed = 0, invalid = 0;

  for (let i = 0; i < targets.length; i += SEND_BATCH_SIZE) {
    const batch = targets.slice(i, i + SEND_BATCH_SIZE);
    const results = await Promise.all(batch.map(async (t) => {
      const msg: Message = {
        token: t.token,
        notification: { title: display.title, body: display.body, ...(display.imageUrl ? { imageUrl: display.imageUrl } : {}) },
        data: payload as unknown as Record<string, string>,
        android: { collapseKey: `broadcast_${ref.id}`, priority: 'high', notification: { tag: `broadcast_${ref.id}`, defaultSound: true } },
        apns: { headers: { 'apns-collapse-id': `broadcast_${ref.id}` }, payload: { aps: { sound: 'default' } } },
      };
      try {
        await messaging.send(msg);
        await ref.collection('deliveries').doc(`${t.uid}_${t.deviceId}`).set({
          uid: t.uid, deviceId: t.deviceId, fcmTokenMasked: maskFcmToken(t.token),
          status: 'sent', sentAt: FieldValue.serverTimestamp(),
        });
        return 'sent' as const;
      } catch (e: any) {
        const code = (e?.errorInfo?.code ?? e?.code) as string | undefined;
        const dead = !!code && DEAD_TOKEN_CODES.has(code);
        await ref.collection('deliveries').doc(`${t.uid}_${t.deviceId}`).set({
          uid: t.uid, deviceId: t.deviceId, fcmTokenMasked: maskFcmToken(t.token),
          status: dead ? 'invalid_token' : 'failed', errorCode: code ?? 'unknown',
          sentAt: FieldValue.serverTimestamp(),
        });
        if (dead) {
          cleanups.push(adminDb.collection('users').doc(t.uid).collection('devices').doc(t.deviceId)
            .set({ enabled: false, disabledAt: FieldValue.serverTimestamp(), disabledReason: code }, { merge: true }));
        }
        return dead ? 'invalid' as const : 'failed' as const;
      }
    }));
    for (const r of results) {
      if (r === 'sent') sent++;
      else if (r === 'invalid') { failed++; invalid++; }
      else failed++;
    }
    await ref.update({ sentDevices: sent, failedDevices: failed, invalidTokens: invalid, updatedAt: FieldValue.serverTimestamp() });
  }

  await Promise.allSettled(cleanups);
  await ref.update({ status: 'sent', updatedAt: FieldValue.serverTimestamp() });

  // Fire-and-forget audit log via the existing auditLogs collection.
  try {
    await adminDb.collection('auditLogs').add({
      action: 'broadcast.sent', actorUid: session.user.uid, actorEmail: session.user.email ?? null,
      targetType: 'broadcast', targetId: ref.id, result: 'success',
      metadata: { audienceType: input.audience.type, sent, failed, invalidTokens: invalid },
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch { /* soft-fail */ }

  revalidatePath('/admin/notifications');
  return { success: true, broadcastId: ref.id, sent, failed, invalidTokens: invalid };
}
