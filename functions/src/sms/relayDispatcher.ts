// Relay dispatcher (Phase 24 — skeleton).
//
// Turns an accepted SMS batch into per-recipient relayJobs, assigns an eligible
// device for the business, and sends an FCM wake. Stable jobId makes it
// idempotent. NOT yet called from escalateSms — the HTTP provider path is
// untouched; this is exercised by tests now and wired into the send path in a
// later phase (provider === 'relay').

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { makeJobId, isHeartbeatStale, capacityRemaining, DEFAULT_MAX_ATTEMPTS } from './relayLogic';

/** Pick one active, fresh, non-exhausted device for the business (skeleton:
 *  first match; capacity-aware routing across a pool is Phase 5). */
async function pickDevice(businessId: string): Promise<{ deviceId: string; fcmToken: string | null } | null> {
  const db = getFirestore();
  const snap = await db.collection('relayDevices')
    .where('businessId', '==', businessId)
    .where('status', '==', 'active')
    .limit(20)
    .get();
  const now = Date.now();
  for (const d of snap.docs) {
    const lastHb = (d.get('lastHeartbeatAt') as Timestamp | undefined)?.toMillis?.() ?? null;
    if (isHeartbeatStale(lastHb, now)) continue;
    const caps = (d.get('caps') ?? { maxPerDay: 0 }) as { maxPerDay: number };
    const counters = (d.get('counters') ?? { sentToday: 0 }) as { sentToday: number };
    if (capacityRemaining(caps, counters, 1) === 0) continue;
    return { deviceId: d.id, fcmToken: (d.get('fcmToken') as string | null) ?? null };
  }
  return null;
}

export interface DispatchResult { jobCount: number; assignedDeviceId: string | null }

export async function dispatchBatchToRelay(batchId: string, businessId: string): Promise<DispatchResult> {
  const db = getFirestore();
  const batchRef = db.collection('smsBatches').doc(batchId);
  const batchSnap = await batchRef.get();
  if (!batchSnap.exists) throw new Error('batch-not-found');
  const smsBody = (batchSnap.get('smsBody') as string) ?? '';

  // Eligible recipients = those queued for sending (not skipped).
  const recips = await batchRef.collection('recipients').where('smsStatus', '==', 'queued').get();
  const device = await pickDevice(businessId);

  let jobCount = 0;
  for (const r of recips.docs) {
    const recipientUid = r.id;
    // Unmasked phone lives on the user doc (never on the batch recipient row).
    const userSnap = await db.collection('users').doc(recipientUid).get();
    const phoneE164 = (userSnap.get('phoneNumber') as string | null) ?? null;
    if (!phoneE164) continue;

    const jobId = makeJobId(batchId, recipientUid);
    const jobRef = db.collection('relayJobs').doc(jobId);
    try {
      await jobRef.create({
        jobId, businessId, batchId, recipientUid, phoneE164, messageBody: smsBody,
        assignedDeviceId: device?.deviceId ?? null,
        assignedSimSubscriptionId: null,
        status: 'queued', attempts: 0, maxAttempts: DEFAULT_MAX_ATTEMPTS,
        leaseOwnerDeviceId: null, leaseExpiresAt: null,
        traceId: jobId,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      jobCount++;
    } catch {
      // Already exists (stable jobId) → idempotent no-op.
    }
  }

  if (device?.fcmToken && jobCount > 0) {
    try {
      await getMessaging().send({
        token: device.fcmToken,
        data: { type: 'relay_wake', batchId, businessId },
        android: { priority: 'high' },
      });
    } catch { /* wake is best-effort; device also polls on heartbeat */ }
  }

  return { jobCount, assignedDeviceId: device?.deviceId ?? null };
}
