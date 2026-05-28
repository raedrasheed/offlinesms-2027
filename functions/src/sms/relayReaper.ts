// Scheduled relay reaper (Phase 24 — reliability).
//
// Runs every minute and ONLY touches relay collections (no production SMS
// impact): expires lapsed job leases (requeue transient / fail when attempts are
// exhausted), marks stale devices offline, and stamps aggregate metrics for the
// dashboard. Idempotent — keyed on the stable jobId and guarded by status.

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';
import {
  reapDecision, backoffMs, isHeartbeatStale, recipientStatusFor, type RelayJobStatus,
} from './relayLogic';

const SCAN_LIMIT = 200;

export const relayReaper = onSchedule(
  { schedule: 'every 1 minutes', timeZone: 'UTC' },
  async () => {
    const db = getFirestore();
    const now = Date.now();
    let expiredLeases = 0, requeued = 0, failedPermanent = 0, devicesOffline = 0;

    // 1) Expire lapsed leases.
    const inFlight = await db.collection('relayJobs')
      .where('status', 'in', ['claimed', 'sending'])
      .limit(SCAN_LIMIT)
      .get();

    for (const doc of inFlight.docs) {
      const leaseMs = (doc.get('leaseExpiresAt') as Timestamp | undefined)?.toMillis?.() ?? null;
      const attempts = (doc.get('attempts') as number) ?? 1;
      const maxAttempts = (doc.get('maxAttempts') as number) ?? 3;
      const status = (doc.get('status') ?? 'claimed') as RelayJobStatus;
      const decision = reapDecision({ status, leaseExpiresAtMs: leaseMs, attempts, maxAttempts }, now);
      if (decision === 'none') continue;

      const businessId = doc.get('businessId') as string;
      const batchId = doc.get('batchId') as string | undefined;
      const recipientUid = doc.get('recipientUid') as string | undefined;

      const applied = await db.runTransaction(async tx => {
        const fresh = await tx.get(doc.ref);
        if (!fresh.exists) return 'none';
        const s = (fresh.get('status') ?? 'claimed') as RelayJobStatus;
        const lm = (fresh.get('leaseExpiresAt') as Timestamp | undefined)?.toMillis?.() ?? null;
        const at = (fresh.get('attempts') as number) ?? 1;
        const max = (fresh.get('maxAttempts') as number) ?? 3;
        const d = reapDecision({ status: s, leaseExpiresAtMs: lm, attempts: at, maxAttempts: max }, now);
        if (d === 'requeue') {
          tx.update(doc.ref, {
            status: 'queued', leaseOwnerDeviceId: null, leaseExpiresAt: null, assignedDeviceId: null,
            nextAttemptAt: Timestamp.fromMillis(now + backoffMs(at)),
            lastError: 'lease-expired', updatedAt: FieldValue.serverTimestamp(),
          });
        } else if (d === 'fail') {
          tx.update(doc.ref, {
            status: 'failed', failedAt: FieldValue.serverTimestamp(),
            lastError: 'lease-expired-max-attempts', messageBody: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        return d;
      });

      if (applied === 'requeue') {
        expiredLeases++; requeued++;
        await writeAuditLog({ action: 'relay.lease.expired', actor: { uid: 'system' }, target: { type: 'relayJob', id: doc.id }, result: 'success', metadata: { businessId, outcome: 'requeued' } });
      } else if (applied === 'fail') {
        expiredLeases++; failedPermanent++;
        if (batchId && recipientUid) {
          await db.collection('smsBatches').doc(batchId).collection('recipients').doc(recipientUid)
            .set({ smsStatus: recipientStatusFor('failed'), reason: 'relay-lease-expired', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
        await writeAuditLog({ action: 'relay.job.failed', actor: { uid: 'system' }, target: { type: 'relayJob', id: doc.id }, result: 'failure', metadata: { businessId, reason: 'lease-expired-max-attempts' } });
      }
    }

    // 2) Mark stale ACTIVE devices offline (never touch paused/revoked).
    const active = await db.collection('relayDevices').where('status', '==', 'active').limit(SCAN_LIMIT).get();
    for (const d of active.docs) {
      const hb = (d.get('lastHeartbeatAt') as Timestamp | undefined)?.toMillis?.() ?? null;
      if (isHeartbeatStale(hb, now)) {
        await d.ref.update({ status: 'offline', updatedAt: FieldValue.serverTimestamp() });
        devicesOffline++;
        await writeAuditLog({ action: 'relay.device.offline', actor: { uid: 'system' }, target: { type: 'relayDevice', id: d.id }, result: 'success', metadata: { businessId: d.get('businessId') } });
      }
    }

    // 3) Aggregate metrics for the dashboard.
    let queuedDepth = 0, claimedDepth = 0;
    try { queuedDepth = (await db.collection('relayJobs').where('status', '==', 'queued').count().get()).data().count; } catch { /* ignore */ }
    try { claimedDepth = (await db.collection('relayJobs').where('status', 'in', ['claimed', 'sending']).count().get()).data().count; } catch { /* ignore */ }
    await db.collection('relayMetrics').doc('summary').set({
      lastRunAt: FieldValue.serverTimestamp(),
      queuedDepth, claimedDepth, expiredLeases, requeued, failedPermanent, devicesOffline,
    }, { merge: true });
  },
);
