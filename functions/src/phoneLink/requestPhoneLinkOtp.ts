// Callable: requestPhoneLinkOtp — send a verification code so a signed-in,
// email-verified account can add ITS OWN phone number.
//
// This is NOT sign-in and never creates an account. Order of checks:
//   1. authenticated → feature enabled (env + runtime doc) → purpose is 'link'
//   2. eligible caller: email account, verified email, Auth-enabled, profile
//      active, signed in within reauthMaxAgeSec
//   3. explicit ownership confirmation + SMS consent (versioned)
//   4. number normalizes to a supported E.164 mobile number
//   5. not emergency-stopped; relay org configured and covering the country
//   6. ONE transaction: account limits → availability → destination, source
//      and global limits → counters + challenge + exactly one relay job.
//      Nothing is queued unless every limit passed in that same transaction.
//
// Input:  { phoneE164, ownershipConfirmed: true, smsConsent: true,
//           consentVersion: 'phone-link-v1', purpose?: 'link' }
// Output: { ok: true, challengeId, expiresAtMs, resendAfterSec, maskedPhone }

import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { appCheckOptions } from '../lib/appCheck';
import { writeAuditLog } from '../lib/auditLog';
import { loadActiveRelayDevices } from '../sms/countryRouting';
import { hasRelayCoverageForCountry, PHONE_LINK_JOB_KIND } from '../sms/relayLogic';
import { requireConfig, requireEligibleCaller, PHONE_LINK_COLLECTIONS as C } from './gates';
import {
  REGION, PHONE_HASH_PEPPER, requirePepper, normalizeLinkNumber,
  numberHeldByOtherAccount, staleClaimOwner,
} from './shared';
import {
  PHONE_LINK_PURPOSE, phoneHmac, sourceHmac, auditTag, generateCode, newChallengeId,
  codeVerifier, maskPhone,
} from './crypto';
import { trustedClientIp, sourceBucket } from './requestSource';
import {
  checkAccount, applyAccount, checkDestination, applyDestination, checkWindows, applyWindows,
  type AccountCounter, type DestinationCounter, type WindowCounter, type LimitRejection,
} from './limits';

const COUNTER_TTL_MS = 31 * 24 * 60 * 60 * 1000;
export const GLOBAL_COUNTER_ID = 'global_phoneLink';

export function buildLinkMessage(code: string, androidAppHash: string | null): string {
  const base = `OfflineSMS: ${code} is your code to add this number to your account. `
    + `Don't share it. Didn't ask? Ignore this message.`;
  return androidAppHash ? `<#> ${base}\n${androidAppHash}` : base;
}

type TxOutcome =
  | { kind: 'queued' }
  | { kind: 'limit'; rejection: LimitRejection }
  | { kind: 'reject'; code: 'phone-unavailable' | 'link-pending-recovery' };

export async function handleRequestPhoneLinkOtp(request: CallableRequest<unknown>) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'auth-required');
  const db = getFirestore();
  const cfg = await requireConfig(db);
  if (!cfg.enabled) throw new HttpsError('failed-precondition', 'phone-link-disabled');

  const data = (request.data ?? {}) as Record<string, unknown>;
  // The purpose is fixed server-side. A tampered value is refused outright
  // rather than silently ignored, so a probing client learns nothing useful.
  if (data.purpose !== undefined && data.purpose !== PHONE_LINK_PURPOSE) {
    throw new HttpsError('invalid-argument', 'purpose-invalid');
  }

  const caller = await requireEligibleCaller(request, db, cfg.limits.reauthMaxAgeSec);
  const uid = caller.uid;

  if (data.ownershipConfirmed !== true || data.smsConsent !== true || data.consentVersion !== cfg.consentVersion) {
    throw new HttpsError('failed-precondition', 'consent-required');
  }
  const num = normalizeLinkNumber(data.phoneE164);
  if (!num) throw new HttpsError('invalid-argument', 'number-not-supported');

  if (cfg.emergencyStop || !cfg.businessId) throw new HttpsError('unavailable', 'service-paused');
  const pepper = requirePepper();

  // One verified phone per account; changing it is out of scope.
  if (caller.user.phoneNumber) {
    const op = await db.collection(C.ops).doc(uid).get();
    const stage = op.exists ? op.get('stage') : 'done';
    throw new HttpsError('failed-precondition', stage === 'done' || stage === 'failed' ? 'already-linked' : 'link-pending-recovery');
  }

  const relays = await loadActiveRelayDevices(cfg.businessId);
  if (!hasRelayCoverageForCountry(relays, num.countryCode, Date.now())) {
    throw new HttpsError('failed-precondition', 'no-relay-for-country');
  }

  const destKey = phoneHmac(pepper, num.e164);
  const raw = request.rawRequest as { headers?: Record<string, string | string[] | undefined>; ip?: string } | undefined;
  const srcKey = sourceHmac(pepper, sourceBucket(
    trustedClientIp(raw?.headers?.['x-forwarded-for'], raw?.ip, cfg.sourceHopsFromRight),
  ));

  const heldByOther = await numberHeldByOtherAccount(db, uid, num.e164);
  const staleOwner = await staleClaimOwner(db, destKey, uid);

  const L = cfg.limits;
  const now = Date.now();
  const challengeId = newChallengeId();
  const code = generateCode();
  const verifier = codeVerifier(pepper, { challengeId, uid, purpose: PHONE_LINK_PURPOSE, phoneKey: destKey }, code);
  const jobId = `plink_${challengeId}`;
  const expiresAtMs = now + L.codeTtlSec * 1000;

  const acctRef = db.collection(C.limits).doc(`acct_${uid}`);
  const destRef = db.collection(C.limits).doc(`dest_${destKey}`);
  const srcRef = db.collection(C.limits).doc(`src_${srcKey}`);
  const globRef = db.collection(C.limits).doc(GLOBAL_COUNTER_ID);
  const chRef = db.collection(C.challenges).doc(uid);
  const claimRef = db.collection(C.claims).doc(destKey);
  const opRef = db.collection(C.ops).doc(uid);
  const jobRef = db.collection('relayJobs').doc(jobId);

  const outcome = await db.runTransaction<TxOutcome>(async tx => {
    const [acctS, destS, srcS, globS, chS, claimS, opS] =
      await tx.getAll(acctRef, destRef, srcRef, globRef, chRef, claimRef, opRef);
    const prevJobId = chS.exists ? (chS.get('jobId') as string | undefined) : undefined;
    const prevJobS = prevJobId ? await tx.get(db.collection('relayJobs').doc(prevJobId)) : null;

    const opStage = opS.exists ? opS.get('stage') : null;
    if (opStage && opStage !== 'done' && opStage !== 'failed') return { kind: 'reject', code: 'link-pending-recovery' };

    const acct = (acctS.data() ?? {}) as AccountCounter;
    const accountRej = checkAccount(acct, destKey, now, L);
    if (accountRej) return { kind: 'limit', rejection: accountRej };

    const meta = { updatedAt: FieldValue.serverTimestamp(), expireAt: Timestamp.fromMillis(now + COUNTER_TTL_MS) };
    const claimUid = claimS.exists ? (claimS.get('uid') as string | undefined) : undefined;
    if (heldByOther || (claimUid && claimUid !== uid && claimUid !== staleOwner)) {
      // Count the probe against the account so availability can't be
      // enumerated faster than codes can be requested. No SMS, no challenge.
      tx.set(acctRef, { ...applyAccount(acct, destKey, now), ...meta });
      return { kind: 'reject', code: 'phone-unavailable' };
    }

    const dest = (destS.data() ?? {}) as DestinationCounter;
    const src = (srcS.data() ?? {}) as WindowCounter;
    const glob = (globS.data() ?? {}) as WindowCounter;
    const rej = checkDestination(dest, now, L)
      ?? checkWindows(src, now, L.sourcePerHour, L.sourcePerDay, 'source')
      ?? checkWindows(glob, now, L.globalPerHour, L.globalPerDay, 'global');
    if (rej) return { kind: 'limit', rejection: rej };

    tx.set(acctRef, { ...applyAccount(acct, destKey, now), ...meta });
    tx.set(destRef, { ...applyDestination(dest, now), ...meta });
    tx.set(srcRef, { ...applyWindows(src, now), ...meta });
    tx.set(globRef, { ...applyWindows(glob, now), ...meta });

    // A new code supersedes the previous one: its verifier is overwritten
    // below, and its SMS is cancelled if no device has taken it yet.
    if (prevJobS?.exists && prevJobS.get('status') === 'queued') {
      tx.update(prevJobS.ref, {
        status: 'failed', failedAt: FieldValue.serverTimestamp(), lastError: 'superseded',
        messageBody: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(),
      });
    }

    tx.set(chRef, {
      challengeId, uid, purpose: PHONE_LINK_PURPOSE,
      phoneKey: destKey, phoneE164: num.e164, countryCode: num.countryCode,
      codeVerifier: verifier,
      attempts: 0, maxAttempts: L.maxVerifyAttempts,
      status: 'pending',
      jobId,
      consentVersion: cfg.consentVersion, ownershipConfirmed: true, smsConsent: true,
      appCheckPresent: caller.appCheckPresent,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(expiresAtMs),
      expireAt: Timestamp.fromMillis(expiresAtMs + 24 * 60 * 60 * 1000),
    });

    // Deterministic id + create(): at most one SMS per challenge, ever.
    tx.create(jobRef, {
      jobId, businessId: cfg.businessId, kind: PHONE_LINK_JOB_KIND,
      batchId: null, recipientUid: null, challengeId,
      phoneE164: num.e164, recipientCountryCode: num.countryCode,
      messageBody: buildLinkMessage(code, cfg.androidAppHash),
      assignedDeviceId: null, assignedSimSubscriptionId: null,
      status: 'queued', attempts: 0, maxAttempts: 1,
      leaseOwnerDeviceId: null, leaseExpiresAt: null, nextAttemptAt: null,
      expiresAt: Timestamp.fromMillis(expiresAtMs),
      traceId: jobId,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    return { kind: 'queued' };
  });

  if (outcome.kind === 'limit') {
    const r = outcome.rejection;
    console.warn('[phoneLink] request limited', { uid, scope: r.scope, code: r.code });
    throw new HttpsError('resource-exhausted', r.code, { retryAfterSec: r.retryAfterSec, scope: r.scope === 'account' ? 'account' : 'other' });
  }
  if (outcome.kind === 'reject') {
    if (outcome.code === 'phone-unavailable') {
      await writeAuditLog({
        action: 'phoneLink.request.unavailable', actor: { uid },
        target: { type: 'phoneHash', id: auditTag(destKey) }, result: 'failure',
      });
      throw new HttpsError('already-exists', 'phone-unavailable');
    }
    throw new HttpsError('failed-precondition', outcome.code);
  }

  // Best-effort low-latency wake of the sending org's devices (they also poll).
  try {
    const devs = await db.collection('relayDevices')
      .where('businessId', '==', cfg.businessId).where('status', '==', 'active').limit(10).get();
    await Promise.all(devs.docs.map(d => {
      const token = d.get('fcmToken') as string | null;
      return token ? getMessaging().send({ token, data: { type: 'relay_wake', businessId: cfg.businessId! }, android: { priority: 'high' } }) : null;
    }).filter(Boolean) as Promise<unknown>[]);
  } catch { /* devices poll */ }

  await writeAuditLog({
    action: 'phoneLink.code.requested', actor: { uid },
    target: { type: 'phoneHash', id: auditTag(destKey) }, result: 'success',
    metadata: { source: auditTag(srcKey), appCheck: caller.appCheckPresent, countryCode: num.countryCode },
  });

  return {
    ok: true,
    challengeId,
    expiresAtMs,
    resendAfterSec: Math.max(L.accountCooldownSec, L.destinationCooldownSec),
    maskedPhone: maskPhone(num.e164),
  };
}

export const requestPhoneLinkOtp = onCall(
  { region: REGION, secrets: [PHONE_HASH_PEPPER], ...appCheckOptions() },
  handleRequestPhoneLinkOtp,
);
