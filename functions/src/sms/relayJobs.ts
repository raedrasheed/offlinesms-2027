// Relay job callables (Phase 24).
//
//   claimRelayJobs     — device leases queued jobs for its business (caps + TTL)
//   reportRelayDelivery — device reports sent/delivered/failed; idempotent;
//                         maps to the existing recipient smsStatus vocabulary.
//
// All writes are Admin-SDK (rules keep relayJobs write-locked). A device may
// only ever touch jobs for its OWN business (enforced via its custom-token
// claims), never another business's.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';
import {
  leaseExpiryMs, capacityRemaining, isClaimable, canDeviceClaimJobCountry,
  normalizeReportStatus, recipientStatusFor, shouldApplyReport,
  classifyFailure, failureOutcome, backoffMs, utcDayKey,
  type RelayJobStatus,
} from './relayLogic';
import { maybeFinalizeRelayBatch } from './relaySettlement';

const REGION = 'us-central1';
const MAX_CLAIM = 50;

interface DeviceCtx { deviceId: string; businessId: string }

function deviceCtx(request: { auth?: { token?: Record<string, unknown> } }, deviceId: unknown): DeviceCtx {
  const token = request.auth?.token;
  if (!token || token.relayDevice !== true) throw new HttpsError('permission-denied', 'not-a-relay-device');
  if (typeof deviceId !== 'string' || token.deviceId !== deviceId) {
    throw new HttpsError('permission-denied', 'device-id-mismatch');
  }
  if (typeof token.businessId !== 'string') throw new HttpsError('permission-denied', 'no-business');
  return { deviceId, businessId: token.businessId };
}

export const claimRelayJobs = onCall({ region: REGION }, async (request) => {
  const data = (request.data ?? {}) as { deviceId?: string; capacity?: number };
  const ctx = deviceCtx(request, data.deviceId);
  const want = Math.max(0, Math.min(MAX_CLAIM, Math.floor(Number(data.capacity) || 0)));
  if (want === 0) return { jobs: [] };

  const db = getFirestore();
  const devRef = db.collection('relayDevices').doc(ctx.deviceId);
  const devSnap = await devRef.get();
  if (!devSnap.exists) throw new HttpsError('not-found', 'device-not-found');
  const status = devSnap.get('status') as string;
  if (status === 'revoked' || status === 'paused') throw new HttpsError('permission-denied', `device-${status}`);

  const caps = (devSnap.get('caps') ?? { maxPerDay: 0 }) as { maxPerDay: number };
  const counters = (devSnap.get('counters') ?? { sentToday: 0 }) as { sentToday: number };
  const budget = capacityRemaining(caps, counters, want);
  if (budget === 0) return { jobs: [] };

  // Country enforcement: a device may only claim jobs for countries it serves.
  // Country-tagged jobs (recipientCountryCode set) are gated; untagged jobs
  // (e.g. sign-in OTP) keep their existing behavior.
  const allowedCountryCodes = (devSnap.get('allowedCountryCodes') as string[] | undefined) ?? [];
  const servesJobCountry = (jobCountry: unknown): boolean =>
    canDeviceClaimJobCountry(allowedCountryCodes, jobCountry);

  // Candidate queued jobs for THIS business (assigned to this device or unassigned).
  const candSnap = await db.collection('relayJobs')
    .where('businessId', '==', ctx.businessId)
    .where('status', '==', 'queued')
    .limit(budget * 2)
    .get();

  const now = Date.now();
  const claimed: Array<{ jobId: string; phoneE164: string; messageBody: string; assignedSimSubscriptionId?: number | null; traceId: string }> = [];

  for (const doc of candSnap.docs) {
    if (claimed.length >= budget) break;
    const assigned = doc.get('assignedDeviceId') as string | undefined;
    if (assigned && assigned !== ctx.deviceId) continue;
    if (!servesJobCountry(doc.get('recipientCountryCode'))) continue; // unsupported country

    // Per-job transaction so two devices never claim the same job.
    const ok = await db.runTransaction(async tx => {
      const fresh = await tx.get(doc.ref);
      if (!fresh.exists) return null;
      if (fresh.get('status') !== 'queued') return null;
      const a = fresh.get('assignedDeviceId') as string | undefined;
      if (a && a !== ctx.deviceId) return null;
      if (!servesJobCountry(fresh.get('recipientCountryCode'))) return null; // re-check under txn
      // Respect exponential-backoff window for requeued jobs.
      const nextAt = (fresh.get('nextAttemptAt') as Timestamp | undefined)?.toMillis?.() ?? null;
      if (!isClaimable(nextAt, now)) return null;
      tx.update(doc.ref, {
        status: 'claimed',
        assignedDeviceId: ctx.deviceId,
        leaseOwnerDeviceId: ctx.deviceId,
        leaseExpiresAt: Timestamp.fromMillis(leaseExpiryMs(now)),
        attempts: FieldValue.increment(1),
        claimedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        jobId: fresh.get('jobId') ?? doc.id,
        phoneE164: fresh.get('phoneE164'),
        messageBody: fresh.get('messageBody'),
        assignedSimSubscriptionId: fresh.get('assignedSimSubscriptionId') ?? null,
        traceId: fresh.get('traceId') ?? doc.id,
      };
    });
    if (ok) claimed.push(ok);
  }

  if (claimed.length > 0) {
    await writeAuditLog({
      action: 'relay.jobs.claimed', actor: { uid: ctx.deviceId },
      target: { type: 'relayDevice', id: ctx.deviceId }, result: 'success',
      metadata: { businessId: ctx.businessId, count: claimed.length },
    });
  }
  return { jobs: claimed };
});

export const reportRelayDelivery = onCall({ region: REGION }, async (request) => {
  const data = (request.data ?? {}) as {
    deviceId?: string; jobId?: string; status?: unknown; reason?: string;
    androidResultCode?: number; simSubscriptionId?: number;
  };
  const ctx = deviceCtx(request, data.deviceId);
  if (typeof data.jobId !== 'string' || !data.jobId) throw new HttpsError('invalid-argument', 'jobId-required');
  const report = normalizeReportStatus(data.status);
  if (!report) throw new HttpsError('invalid-argument', 'status-invalid');

  const db = getFirestore();
  const jobRef = db.collection('relayJobs').doc(data.jobId);

  const devRef = db.collection('relayDevices').doc(ctx.deviceId);

  const applied = await db.runTransaction(async tx => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) throw new HttpsError('not-found', 'job-not-found');
    if (snap.get('businessId') !== ctx.businessId) throw new HttpsError('permission-denied', 'cross-business');
    const leaseOwner = snap.get('leaseOwnerDeviceId') as string | undefined;
    if (leaseOwner !== ctx.deviceId) throw new HttpsError('permission-denied', 'not-lease-owner');

    const current = (snap.get('status') ?? 'queued') as RelayJobStatus;
    const base = { changed: false, requeued: false, batchId: snap.get('batchId'), recipientUid: snap.get('recipientUid') };
    if (!shouldApplyReport(current, report)) return base;

    const attempts = (snap.get('attempts') as number) ?? 1;
    const maxAttempts = (snap.get('maxAttempts') as number) ?? 3;
    const now = Date.now();

    // Decide outcome. A transient failure with attempts left → requeue (keep
    // body for resend); otherwise the report is terminal (purge body).
    let finalStatus: RelayJobStatus = report;
    let requeued = false;
    if (report === 'failed') {
      const cls = classifyFailure(data.androidResultCode, data.reason);
      if (failureOutcome(attempts, maxAttempts, cls) === 'requeue') { finalStatus = 'queued'; requeued = true; }
    }

    // Firestore transactions require ALL reads before ANY writes — so read the
    // device doc (for terminal counters) up front, before updating the job.
    const devSnap = !requeued ? await tx.get(devRef) : null;

    const patch: Record<string, unknown> = { status: finalStatus, updatedAt: FieldValue.serverTimestamp() };
    if (requeued) {
      patch.leaseOwnerDeviceId = null;
      patch.leaseExpiresAt = null;
      patch.assignedDeviceId = null;                 // let any device pick it up
      patch.nextAttemptAt = Timestamp.fromMillis(now + backoffMs(attempts));
      patch.lastError = (data.reason ?? '').slice(0, 200);
      patch.lastErrorCode = String(data.androidResultCode ?? '');
    } else {
      if (report === 'sent')      patch.sentAt = FieldValue.serverTimestamp();
      if (report === 'delivered') patch.deliveredAt = FieldValue.serverTimestamp();
      if (report === 'failed')   { patch.failedAt = FieldValue.serverTimestamp(); patch.lastError = (data.reason ?? '').slice(0, 200); patch.lastErrorCode = String(data.androidResultCode ?? ''); }
      patch.messageBody = FieldValue.delete();        // privacy: purge on terminal
    }
    tx.update(jobRef, patch);

    // Device counters (daily-rolling, UTC) — only on a terminal report.
    if (!requeued && devSnap?.exists) {
      const counterField = report === 'sent' ? 'sentToday' : report === 'delivered' ? 'deliveredToday' : 'failedToday';
      const day = utcDayKey();
      const c = (devSnap.get('counters') as Record<string, unknown>) ?? {};
      const sameDay = c.date === day;
      const cur = sameDay ? (c[counterField] as number) ?? 0 : 0;
      tx.set(devRef, {
        counters: {
          sentToday: sameDay ? (c.sentToday as number) ?? 0 : 0,
          failedToday: sameDay ? (c.failedToday as number) ?? 0 : 0,
          deliveredToday: sameDay ? (c.deliveredToday as number) ?? 0 : 0,
          date: day,
          [counterField]: cur + 1,
        },
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    return { changed: true, requeued, batchId: base.batchId, recipientUid: base.recipientUid };
  });

  if (applied.changed && applied.requeued) {
    await writeAuditLog({
      action: 'relay.job.requeued', actor: { uid: ctx.deviceId },
      target: { type: 'relayJob', id: data.jobId }, result: 'success',
      metadata: { businessId: ctx.businessId, reasonCode: String(data.androidResultCode ?? '') },
    });
  } else if (applied.changed && applied.batchId && applied.recipientUid) {
    // Mirror terminal status to the batch recipient so receipts/refunds keep working.
    await db.collection('smsBatches').doc(applied.batchId)
      .collection('recipients').doc(applied.recipientUid)
      .set({ smsStatus: recipientStatusFor(report), reason: report === 'failed' ? (data.reason ?? 'relay-failed') : null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    await writeAuditLog({
      action: `relay.job.${report}`, actor: { uid: ctx.deviceId },
      target: { type: 'relayJob', id: data.jobId }, result: report === 'failed' ? 'failure' : 'success',
      metadata: { businessId: ctx.businessId, status: report },
    });
    // Finalize the batch once all relay jobs are terminal → existing settlement.
    if (applied.batchId) { try { await maybeFinalizeRelayBatch(applied.batchId); } catch { /* reaper retries */ } }
  }
  return { ok: true, applied: applied.changed, requeued: applied.requeued };
});
