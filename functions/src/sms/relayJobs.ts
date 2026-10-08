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
  leaseExpiryMs, isClaimable, canDeviceClaimJobCountry,
  normalizeReportStatus, recipientStatusFor, shouldApplyReport,
  classifyFailure, failureOutcome, backoffMs, utcDayKey,
  isVerificationJobKind, verificationClaimDecision, verificationPurposeOf, PUBLIC_OTP_JOB_KIND,
  relayCapacityCheck, reserveRelayUsage, type CapsLike, type RelayUsage,
  type RelayJobStatus,
} from './relayLogic';
import { maybeFinalizeRelayBatch } from './relaySettlement';
import { loadPolicyDoc, verificationJobStillValid, OTP_POLICY_DOC } from '../verification/policy';

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

/** Capability a relay app declares when it calls authorizeRelaySend right
 *  before every verification-code SMS. Older builds don't, so they are never
 *  handed verification work (it stays queued for a capable device or expires). */
export const SEND_AUTH_CAPABILITY = 'send-auth-v1';

export interface ClaimedRelayJob {
  jobId: string; phoneE164: string; messageBody: string;
  assignedSimSubscriptionId?: number | null; traceId: string;
  kind: string | null;
  /** Device must call authorizeRelaySend and get ok before handing to SmsManager. */
  requiresSendAuth: boolean;
  /** Verification jobs: remaining lifetime (ms) measured when the response is
   *  built. The device starts it at the moment it SENT the request (a
   *  conservative origin: response latency only shortens it, never extends). */
  sendWithinMs: number | null;
  /** Server attempt number for this lease (1, 2, …) — identifies this hand-out. */
  attempt: number;
}

/** Max age of a send authorization on the device (bounds stale "ok"s). */
export const SEND_AUTH_VALID_MS = 15_000;

/** Pure: does the device's CURRENT routing still allow this job's country? */
export function deviceRoutingAllows(
  dev: { countryRoutingEnabled?: unknown; allowedCountryCodes?: unknown },
  jobCountry: unknown,
): boolean {
  if (typeof jobCountry !== 'string' || !jobCountry) return true; // untagged
  if (dev.countryRoutingEnabled !== true) return false;
  return canDeviceClaimJobCountry(Array.isArray(dev.allowedCountryCodes) ? dev.allowedCountryCodes as string[] : [], jobCountry);
}

export const claimRelayJobs = onCall({ region: REGION }, async (request) => {
  const data = (request.data ?? {}) as { deviceId?: string; capacity?: number; clientCaps?: unknown };
  const ctx = deviceCtx(request, data.deviceId);
  const want = Math.max(0, Math.min(MAX_CLAIM, Math.floor(Number(data.capacity) || 0)));
  if (want === 0) return { jobs: [] };
  const sendAuthCapable = Array.isArray(data.clientCaps) && data.clientCaps.includes(SEND_AUTH_CAPABILITY);

  const db = getFirestore();
  const devRef = db.collection('relayDevices').doc(ctx.deviceId);
  const devSnap = await devRef.get();
  if (!devSnap.exists) throw new HttpsError('not-found', 'device-not-found');
  const status = devSnap.get('status') as string;
  if (status === 'revoked' || status === 'paused') throw new HttpsError('permission-denied', `device-${status}`);

  // Candidate queued jobs for THIS business (assigned to this device or unassigned).
  const candSnap = await db.collection('relayJobs')
    .where('businessId', '==', ctx.businessId)
    .where('status', '==', 'queued')
    .limit(want * 3)
    .get();

  const now = Date.now();
  const claimed: ClaimedRelayJob[] = [];

  // Current verification policy, read at most once per claim. An unreadable
  // policy means verification work is SKIPPED (left queued; it expires) —
  // never handed out, and never cancelled on a transient read error.
  let policy: { ok: boolean; doc: Record<string, unknown> | null } | null = null;
  const loadPolicy = async () => {
    if (!policy) {
      try { policy = { ok: true, doc: await loadPolicyDoc(db) }; } catch { policy = { ok: false, doc: null }; }
    }
    return policy;
  };
  let cancelledVerification = 0;
  let capacityExhausted: string | null = null;
  const expiries = new Map<string, number | null>();

  for (const doc of candSnap.docs) {
    if (claimed.length >= want) break;
    const assigned = doc.get('assignedDeviceId') as string | undefined;
    if (assigned && assigned !== ctx.deviceId) continue;
    const kind = doc.get('kind');
    const isVerification = isVerificationJobKind(kind);
    if (isVerification && !sendAuthCapable && kind !== PUBLIC_OTP_JOB_KIND) continue; // old relay build
    const pol = isVerification ? await loadPolicy() : null;
    if (pol && !pol.ok) continue;

    // Per-job transaction: re-reads the job AND the device so status, pause,
    // revocation, country routing and capacity are enforced at claim time, and
    // the capacity reservation commits atomically with the lease.
    const ok = await db.runTransaction(async tx => {
      const [fresh, dev] = await tx.getAll(doc.ref, devRef);
      if (!fresh.exists || fresh.get('status') !== 'queued') return null;
      if (!dev.exists) return null;
      const devStatus = dev.get('status') as string;
      if (devStatus === 'revoked' || devStatus === 'paused') return 'device-blocked' as const;

      // Verification jobs: cancel (never deliver) legacy public OTPs and any job
      // that is expired or no longer matches the current sender/policy.
      if (isVerificationJobKind(fresh.get('kind'))) {
        const expiresAtMs = (fresh.get('expiresAt') as Timestamp | undefined)?.toMillis?.() ?? null;
        const legacy = verificationClaimDecision({ kind: fresh.get('kind'), expiresAtMs }, now, true);
        const verdict = legacy === 'cancel-public-otp-disabled' ? 'public-otp-disabled'
          : verificationJobStillValid({
            purpose: verificationPurposeOf(fresh.get('kind')),
            businessId: fresh.get('businessId'), policyVersion: fresh.get('policyVersion'), expiresAtMs,
          }, pol?.doc ?? null, now);
        if (verdict !== 'ok') {
          tx.update(doc.ref, {
            status: 'failed', failedAt: FieldValue.serverTimestamp(), lastError: verdict,
            messageBody: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(),
          });
          return 'cancelled' as const;
        }
      }

      const a = fresh.get('assignedDeviceId') as string | undefined;
      if (a && a !== ctx.deviceId) return null;
      // Country: a tagged job needs a device with country routing ENABLED that
      // serves the country (the switch is re-read here, not cached).
      if (!deviceRoutingAllows(dev.data() ?? {}, fresh.get('recipientCountryCode'))) return null;
      const nextAt = (fresh.get('nextAttemptAt') as Timestamp | undefined)?.toMillis?.() ?? null;
      if (!isClaimable(nextAt, now)) return null;

      const cap = relayCapacityCheck(dev.get('caps') as CapsLike | undefined, dev.get('usage') as RelayUsage | undefined, now);
      if (!cap.ok) return { capacity: cap.window as string } as const;

      const verification = isVerificationJobKind(fresh.get('kind'));
      tx.update(devRef, { usage: reserveRelayUsage(dev.get('usage') as RelayUsage | undefined, now), updatedAt: FieldValue.serverTimestamp() });
      tx.update(doc.ref, {
        status: 'claimed',
        assignedDeviceId: ctx.deviceId,
        leaseOwnerDeviceId: ctx.deviceId,
        leaseExpiresAt: Timestamp.fromMillis(leaseExpiryMs(now)),
        attempts: FieldValue.increment(1),
        requiresSendAuth: verification,
        claimedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      const expiresAtMs = (fresh.get('expiresAt') as Timestamp | undefined)?.toMillis?.() ?? null;
      const job: ClaimedRelayJob = {
        jobId: fresh.get('jobId') ?? doc.id,
        phoneE164: fresh.get('phoneE164'),
        messageBody: fresh.get('messageBody'),
        assignedSimSubscriptionId: fresh.get('assignedSimSubscriptionId') ?? null,
        traceId: fresh.get('traceId') ?? doc.id,
        kind: (fresh.get('kind') as string | undefined) ?? null,
        requiresSendAuth: verification,
        sendWithinMs: null, // filled right before the response is sent
        attempt: ((fresh.get('attempts') as number | undefined) ?? 0) + 1,
      };
      return { job, expiresAtMs: verification ? expiresAtMs : null };
    });
    if (ok === 'device-blocked') break;
    if (ok === 'cancelled') { cancelledVerification++; continue; }
    if (ok && 'capacity' in ok) { capacityExhausted = ok.capacity ?? null; break; }
    if (ok && 'job' in ok) { claimed.push(ok.job); expiries.set(ok.job.jobId, ok.expiresAtMs); }
  }

  if (cancelledVerification > 0) {
    await writeAuditLog({
      action: 'relay.verification.cancelled', actor: { uid: ctx.deviceId },
      target: { type: 'relayDevice', id: ctx.deviceId }, result: 'success',
      metadata: { businessId: ctx.businessId, count: cancelledVerification },
    });
  }

  if (claimed.length > 0) {
    await writeAuditLog({
      action: 'relay.jobs.claimed', actor: { uid: ctx.deviceId },
      target: { type: 'relayDevice', id: ctx.deviceId }, result: 'success',
      metadata: { businessId: ctx.businessId, count: claimed.length, capacityExhausted },
    });
  }
  // Remaining lifetime computed as late as possible (after every transaction
  // and audit write), so server processing time is never granted twice.
  const t = Date.now();
  for (const j of claimed) {
    const e = expiries.get(j.jobId);
    if (j.requiresSendAuth) j.sendWithinMs = e != null ? Math.max(0, e - t) : 0;
  }
  return { jobs: claimed, capacityExhausted };
});

/**
 * authorizeRelaySend — the LAST server check before the device hands a job to
 * SmsManager. Required for verification-code jobs (requiresSendAuth). Atomically
 * re-validates: lease owner, device not paused/revoked, job still `claimed`
 * (a second authorization for the same job is refused — duplicate hand-off),
 * and for verification jobs the current policy (on, not stopped, same sender
 * and policyVersion), expiry, and that the challenge is still the live,
 * unconsumed one. On success the job moves to `sending`.
 *
 * Remaining, unavoidable window: between this response and the SmsManager call
 * on the device (milliseconds in normal operation). A message already handed to
 * the modem/carrier cannot be recalled.
 */
export const authorizeRelaySend = onCall({ region: REGION }, async (request) => {
  const data = (request.data ?? {}) as { deviceId?: string; jobId?: string };
  const ctx = deviceCtx(request, data.deviceId);
  if (typeof data.jobId !== 'string' || !data.jobId) throw new HttpsError('invalid-argument', 'jobId-required');
  const db = getFirestore();
  const jobRef = db.collection('relayJobs').doc(data.jobId);
  const devRef = db.collection('relayDevices').doc(ctx.deviceId);
  const policyRef = db.collection(OTP_POLICY_DOC.collection).doc(OTP_POLICY_DOC.doc);

  type AuthResult = { ok: boolean; reason?: string; expiresAtMs?: number | null };
  const result = await db.runTransaction<AuthResult>(async tx => {
    // Time is taken INSIDE the callback so a transaction retry re-evaluates
    // expiry/lease at the moment of the attempt that commits.
    const now = Date.now();
    const [job, dev, pol] = await tx.getAll(jobRef, devRef, policyRef);
    if (!job.exists) return { ok: false, reason: 'job-not-found' };
    if (job.get('businessId') !== ctx.businessId) return { ok: false, reason: 'cross-business' };
    if (job.get('leaseOwnerDeviceId') !== ctx.deviceId) return { ok: false, reason: 'not-lease-owner' };
    const st = job.get('status') as string;
    if (st === 'sending' || st === 'sent' || st === 'delivered') return { ok: false, reason: 'already-authorized' };
    if (st !== 'claimed') return { ok: false, reason: `job-${st}` };
    const leaseMs = (job.get('leaseExpiresAt') as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (leaseMs <= now) return { ok: false, reason: 'lease-expired' };
    const devStatus = dev.exists ? (dev.get('status') as string) : 'missing';
    if (devStatus === 'revoked' || devStatus === 'paused' || devStatus === 'missing') {
      return { ok: false, reason: `device-${devStatus}` };
    }

    const verificationJob = isVerificationJobKind(job.get('kind'));
    // Country routing is re-evaluated at the final boundary too (N3): a switch
    // or country removal after the claim stops the hand-off.
    if (!deviceRoutingAllows(dev.data() ?? {}, job.get('recipientCountryCode'))) {
      if (verificationJob) {
        tx.update(jobRef, {
          status: 'failed', failedAt: FieldValue.serverTimestamp(), lastError: 'country-not-allowed',
          messageBody: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        // Business SMS: nothing was handed off, so give it back to the queue
        // for a device that still serves the country.
        tx.update(jobRef, {
          status: 'queued', leaseOwnerDeviceId: null, leaseExpiresAt: null, assignedDeviceId: null,
          lastError: 'country-not-allowed', updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return { ok: false, reason: 'country-not-allowed' };
    }

    let refuse: string | null = null;
    const expiresAtMs = (job.get('expiresAt') as Timestamp | undefined)?.toMillis?.() ?? null;
    if (verificationJob) {
      const purpose = verificationPurposeOf(job.get('kind'));
      const v = purpose ? verificationJobStillValid({
        purpose, businessId: job.get('businessId'), policyVersion: job.get('policyVersion'), expiresAtMs,
      }, pol.exists ? (pol.data() ?? {}) : null, now) : 'public-otp-disabled';
      if (v !== 'ok') refuse = v;
      else {
        const path = job.get('challengePath') as string | undefined;
        const ch = path ? await tx.get(db.doc(path)) : null;
        if (!ch?.exists || ch.get('challengeId') !== job.get('challengeId') || ch.get('status') !== 'pending') {
          refuse = 'challenge-not-current';
        }
      }
    }
    if (refuse) {
      tx.update(jobRef, {
        status: 'failed', failedAt: FieldValue.serverTimestamp(), lastError: refuse,
        messageBody: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(),
      });
      return { ok: false, reason: refuse };
    }
    tx.update(jobRef, { status: 'sending', sendAuthorizedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return { ok: true, expiresAtMs: verificationJob ? expiresAtMs : null };
  });
  if (!result.ok) {
    console.warn('[relay] send not authorized', { device: ctx.deviceId, reason: result.reason });
    return { ok: false, reason: result.reason };
  }
  // The device must hand off before BOTH budgets run out, measured from when
  // it sent THIS request: the code's remaining lifetime (computed now, after
  // the transaction) and a short maximum authorization age.
  const remaining = result.expiresAtMs != null ? Math.max(0, result.expiresAtMs - Date.now()) : SEND_AUTH_VALID_MS;
  return { ok: true, sendWithinMs: Math.min(remaining, SEND_AUTH_VALID_MS) };
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
      if (failureOutcome(attempts, maxAttempts, cls, snap.get('kind')) === 'requeue') { finalStatus = 'queued'; requeued = true; }
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
    if (report === 'delivered' && current !== 'sent') patch.sentAt = FieldValue.serverTimestamp();
    tx.update(jobRef, patch);

    // Delivery METRICS (daily, UTC) — reporting only. Send-capacity enforcement
    // uses the reservation in relayDevices.usage (claim time), never these.
    // A 'delivered' that arrives before its 'sent' (out-of-order intents) also
    // counts the send, because the later 'sent' will be ignored as stale.
    if (!requeued && devSnap?.exists) {
      const day = utcDayKey();
      const c = (devSnap.get('counters') as Record<string, unknown>) ?? {};
      const sameDay = c.date === day;
      const next = {
        sentToday: sameDay ? (c.sentToday as number) ?? 0 : 0,
        failedToday: sameDay ? (c.failedToday as number) ?? 0 : 0,
        deliveredToday: sameDay ? (c.deliveredToday as number) ?? 0 : 0,
        date: day,
      };
      if (report === 'sent') next.sentToday++;
      else if (report === 'failed') next.failedToday++;
      else {
        next.deliveredToday++;
        if (current !== 'sent') next.sentToday++;
      }
      tx.set(devRef, { counters: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
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
