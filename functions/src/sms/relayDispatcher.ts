// Relay dispatcher (Phase 5 — multi-device routing).
//
// Turns the relay-eligible recipients of an accepted batch into per-recipient
// relayJobs, distributing them across the business's healthy devices by spare
// capacity (least-loaded). Stable jobId → idempotent (duplicate dispatch never
// duplicates jobs). Devices that are paused/revoked/offline/stale or
// cap-exhausted receive nothing. Cross-business is impossible: only devices and
// jobs for the given businessId are touched.

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import {
  makeJobId, deviceRemaining, isDeviceRoutable, routeLeastLoaded,
  DEFAULT_MAX_ATTEMPTS, type RouteDevice,
} from './relayLogic';

export interface DispatchResult {
  routed: number;          // recipients given a relay job
  unrouted: string[];      // recipientUids with no relay job (caller may HTTP-fallback)
  assignedDeviceIds: string[];
}

async function routableDevices(businessId: string, nowMs: number): Promise<RouteDevice[]> {
  const db = getFirestore();
  const snap = await db.collection('relayDevices')
    .where('businessId', '==', businessId)
    .where('status', '==', 'active')
    .limit(50)
    .get();
  const out: RouteDevice[] = [];
  for (const d of snap.docs) {
    const caps = (d.get('caps') ?? { maxPerDay: 0 }) as { maxPerDay: number };
    const counters = (d.get('counters') ?? {}) as { sentToday?: number };
    const remaining = deviceRemaining(caps, counters);
    const lastHb = (d.get('lastHeartbeatAt') as any)?.toMillis?.() ?? null;
    if (isDeviceRoutable({ status: 'active', lastHeartbeatMs: lastHb, remaining }, nowMs)) {
      out.push({ deviceId: d.id, remaining });
    }
  }
  return out;
}

/**
 * @param allowUnassignedQueue relay-only mode: recipients with no spare device
 *   capacity are still queued (assignedDeviceId=null) to be claimed later.
 *   Hybrid mode passes false so unrouted recipients are returned for HTTP fallback.
 */
export async function dispatchBatchToRelay(
  batchId: string,
  businessId: string,
  opts: { allowUnassignedQueue?: boolean } = {},
): Promise<DispatchResult> {
  const allowUnassignedQueue = opts.allowUnassignedQueue ?? true;
  const db = getFirestore();
  const now = Date.now();

  const batchRef = db.collection('smsBatches').doc(batchId);
  const batchSnap = await batchRef.get();
  if (!batchSnap.exists) throw new Error('batch-not-found');
  const smsBody = (batchSnap.get('smsBody') as string) ?? '';

  const recips = await batchRef.collection('recipients').where('smsStatus', '==', 'queued').get();
  const recipientUids = recips.docs.map(d => d.id);

  const devices = await routableDevices(businessId, now);
  const { assignments, unrouted } = routeLeastLoaded(recipientUids, devices);
  const assignedDevice = new Map(assignments.map(a => [a.uid, a.deviceId]));

  const assignedDeviceIds = new Set<string>();
  let routed = 0;
  const trulyUnrouted: string[] = [];

  for (const recipientUid of recipientUids) {
    const deviceId = assignedDevice.get(recipientUid) ?? null;
    if (!deviceId && !allowUnassignedQueue) { trulyUnrouted.push(recipientUid); continue; }

    const userSnap = await db.collection('users').doc(recipientUid).get();
    const phoneE164 = (userSnap.get('phoneNumber') as string | null) ?? null;
    if (!phoneE164) { if (!deviceId) trulyUnrouted.push(recipientUid); continue; }

    const jobId = makeJobId(batchId, recipientUid);
    try {
      await db.collection('relayJobs').doc(jobId).create({
        jobId, businessId, batchId, recipientUid, phoneE164, messageBody: smsBody,
        assignedDeviceId: deviceId,
        assignedSimSubscriptionId: null,
        status: 'queued', attempts: 0, maxAttempts: DEFAULT_MAX_ATTEMPTS,
        leaseOwnerDeviceId: null, leaseExpiresAt: null, nextAttemptAt: null,
        traceId: jobId,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      routed++;
      if (deviceId) assignedDeviceIds.add(deviceId);
    } catch {
      // Stable jobId already exists → idempotent no-op (duplicate dispatch).
    }
  }

  // Wake the devices that received work.
  for (const deviceId of assignedDeviceIds) {
    const dev = await db.collection('relayDevices').doc(deviceId).get();
    const token = dev.get('fcmToken') as string | null;
    if (token) {
      try {
        await getMessaging().send({ token, data: { type: 'relay_wake', batchId, businessId }, android: { priority: 'high' } });
      } catch { /* best-effort; device also polls */ }
    }
  }

  return { routed, unrouted: trulyUnrouted, assignedDeviceIds: [...assignedDeviceIds] };
}
