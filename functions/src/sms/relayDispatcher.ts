// Relay dispatcher — country-aware multi-device routing.
//
// Turns a batch's relay-eligible recipients into per-recipient relayJobs,
// routing each recipient ONLY to a relay that explicitly covers its detected
// country (active + fresh + countryRoutingEnabled + allowedCountryCodes ∋ cc),
// least-loaded first. This is the defensive backend chokepoint: NO relayJob is
// created without an eligible relay for the recipient's country. Recipients whose
// country has no live relay are skipped (no_relay_for_country) — never sent via
// another country's relay, never HTTP-fallen-back. Cross-business is impossible:
// only the given businessId's devices/jobs are touched. Stable jobId → idempotent.

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { normalizePhoneAndCountry } from '../lib/phoneCountry';
import {
  makeJobId, pickRelayForCountry, hasRelayCoverageForCountry, summarizeOutcomes,
  DEFAULT_MAX_ATTEMPTS, type RecipientOutcome, type DispatchSummary, type RouteDeviceCountry,
} from './relayLogic';
import { loadActiveRelayDevices } from './countryRouting';
import { readUserPhone } from '../lib/userPrivate';

export interface DispatchResult {
  routed: number;            // recipients given a relay job
  unrouted: string[];        // COVERED recipients with no spare capacity (hybrid → HTTP fallback)
  assignedDeviceIds: string[];
  summary: DispatchSummary;  // per-country counts + skippedByReason
}

interface CreateJobParams {
  batchId: string; businessId: string; recipientUid: string;
  phoneE164: string; country: string; smsBody: string; assignedDeviceId: string | null;
}

async function createRelayJob(db: FirebaseFirestore.Firestore, p: CreateJobParams): Promise<boolean> {
  const jobId = makeJobId(p.batchId, p.recipientUid);
  try {
    await db.collection('relayJobs').doc(jobId).create({
      jobId, businessId: p.businessId, batchId: p.batchId, recipientUid: p.recipientUid,
      phoneE164: p.phoneE164, recipientCountryCode: p.country, messageBody: p.smsBody,
      assignedDeviceId: p.assignedDeviceId, assignedSimSubscriptionId: null,
      status: 'queued', attempts: 0, maxAttempts: DEFAULT_MAX_ATTEMPTS,
      leaseOwnerDeviceId: null, leaseExpiresAt: null, nextAttemptAt: null,
      traceId: jobId,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  } catch {
    return false; // stable jobId already exists → idempotent no-op
  }
}

async function markRecipientSkipped(
  batchRef: FirebaseFirestore.DocumentReference, recipientUid: string, reason: string,
): Promise<void> {
  await batchRef.collection('recipients').doc(recipientUid).set(
    { smsStatus: 'skipped', skipReason: reason, reason, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

/**
 * @param allowUnassignedQueue relay-only mode: covered recipients with no spare
 *   device capacity are still queued (assignedDeviceId=null) to be claimed later
 *   by a country-serving device. Hybrid mode passes false so covered-overflow
 *   recipients are returned in `unrouted` for HTTP fallback. Uncovered countries
 *   are NEVER returned for fallback — they are skipped (no_relay_for_country).
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
  const phoneOnDoc = new Map<string, string | null>(
    recips.docs.map(d => [d.id, (d.get('phoneE164') as string | null) ?? null]),
  );

  // In-memory device pool (capacity decremented as we assign → least-loaded).
  const pool: RouteDeviceCountry[] = await loadActiveRelayDevices(businessId);

  const assignedDeviceIds = new Set<string>();
  const outcomes: RecipientOutcome[] = [];
  const trulyUnrouted: string[] = [];
  let routed = 0;

  for (const recipientUid of recipientUids) {
    let phoneE164 = phoneOnDoc.get(recipientUid) ?? null;
    if (!phoneE164) {
      // F1 Phase B: read from users/{uid}/userPrivate/profile (public fallback inside).
      phoneE164 = await readUserPhone(db, recipientUid);
    }

    const norm = normalizePhoneAndCountry(phoneE164 ?? '');
    if (!norm.isValid || !norm.e164 || !norm.countryCode) {
      const reason = (!norm.isValid || !norm.e164) ? 'invalid_phone' : 'unsupported_country';
      await markRecipientSkipped(batchRef, recipientUid, reason);
      outcomes.push({ countryCode: norm.countryCode ?? null, queued: false, reason });
      continue;
    }
    const country = norm.countryCode;

    // Assign to a country-eligible relay with spare capacity (least-loaded).
    const picked = pickRelayForCountry(pool, country, now);
    if (picked) {
      const ok = await createRelayJob(db, {
        batchId, businessId, recipientUid, phoneE164: norm.e164, country, smsBody,
        assignedDeviceId: picked.deviceId,
      });
      if (ok) { picked.remaining -= 1; assignedDeviceIds.add(picked.deviceId); routed++; }
      outcomes.push({ countryCode: country, queued: true });
      continue;
    }

    // No spare capacity now — but is the country covered by a live relay?
    if (hasRelayCoverageForCountry(pool, country, now)) {
      if (allowUnassignedQueue) {
        const ok = await createRelayJob(db, {
          batchId, businessId, recipientUid, phoneE164: norm.e164, country, smsBody,
          assignedDeviceId: null,   // claimed later by a country-serving device
        });
        if (ok) routed++;
        outcomes.push({ countryCode: country, queued: true });
      } else {
        trulyUnrouted.push(recipientUid);       // hybrid: HTTP-fallback (country IS covered)
        outcomes.push({ countryCode: country, queued: true });
      }
      continue;
    }

    // No relay covers this country → do NOT send (no cross-country, no HTTP).
    await markRecipientSkipped(batchRef, recipientUid, 'no_relay_for_country');
    outcomes.push({ countryCode: country, queued: false, reason: 'no_relay_for_country' });
  }

  // Wake the devices that received assigned work.
  for (const deviceId of assignedDeviceIds) {
    const dev = await db.collection('relayDevices').doc(deviceId).get();
    const token = dev.get('fcmToken') as string | null;
    if (token) {
      try {
        await getMessaging().send({ token, data: { type: 'relay_wake', batchId, businessId }, android: { priority: 'high' } });
      } catch { /* best-effort; device also polls */ }
    }
  }

  return {
    routed, unrouted: trulyUnrouted, assignedDeviceIds: [...assignedDeviceIds],
    summary: summarizeOutcomes(outcomes),
  };
}
