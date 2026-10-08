// Callable: requestPhoneAuthCode — send a sign-in / sign-up code to a phone
// number. UNAUTHENTICATED by design (the person may not have an account yet).
//
// Admission, in order, before anything is queued:
//   1. policy: env PHONE_AUTH_ENABLED + smsConfig/otp master/stop/sender/signin
//   2. optional App Check requirement (policy `signin.attestation`)
//   3. purpose fixed to 'signin'; number = valid E.164 + supported 59/56 prefix
//   4. live relay coverage for the number's country
//   5. ONE Firestore transaction:
//        session valid → idempotent replay? → single-use proof-of-work for THIS
//        number → session / installation / source / destination / global /
//        shared budgets → counters + challenge + exactly one relay job
//      Every proof check consumes the session's nonce (a fresh one is returned),
//      so a proof is never reusable — even when the request is then refused.
//
// Input:  { sessionToken, phoneE164, powNonce, powSolution, requestId, purpose? }
// Output: { challengeId, expiresAtMs, resendAfterSec, maskedPhone, pow }
// Errors carry { retryAfterSec?, pow? } details so the client can continue.

import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { appCheckOptions } from '../lib/appCheck';
import { writeAuditLog } from '../lib/auditLog';
import { loadActiveRelayDevices } from '../sms/countryRouting';
import { hasRelayCoverageForCountry, PHONE_AUTH_JOB_KIND } from '../sms/relayLogic';
import { REGION, PHONE_HASH_PEPPER, requirePepper, normalizeLinkNumber } from '../phoneLink/shared';
import { phoneHmac, auditTag, generateCode, newChallengeId, codeVerifier, maskPhone } from '../phoneLink/crypto';
import {
  checkDestination, applyDestination, checkWindows, applyWindows, checkDistinctPerDay, applyDistinctPerDay,
  windowCount, HOUR_MS, DAY_MS,
  type DestinationCounter, type WindowCounter, type DistinctCounter, type LimitRejection,
} from '../phoneLink/limits';
import { verifyPow, newPowNonce, adaptiveBits } from './pow';
import {
  PHONE_AUTH_COLLECTIONS as C, SIGNIN_GLOBAL_COUNTER_ID, SHARED_COUNTER_ID, REQUEST_ID_RE,
  requireSigninConfig, requireAttestation, sourceKeyFor, sessionKeyFor,
} from './shared';

export function buildSigninMessage(code: string, androidAppHash: string | null): string {
  const base = `OfflineSMS: ${code} is your sign-in code. Don't share it. Didn't ask? Ignore this message.`;
  return androidAppHash ? `<#> ${base}\n${androidAppHash}` : base;
}

interface PowState { nonce: string; bits: number; expiresAtMs: number }
interface CachedResponse { challengeId: string; expiresAtMs: number; resendAfterSec: number; maskedPhone: string }

type TxOut =
  | { kind: 'queued'; response: CachedResponse; pow: PowState }
  | { kind: 'replay'; response: CachedResponse; pow: PowState }
  | { kind: 'error'; code: string; httpCode: 'failed-precondition' | 'resource-exhausted' | 'permission-denied' | 'already-exists'; pow?: PowState; rej?: LimitRejection };

export async function handleRequestPhoneAuthCode(request: CallableRequest<unknown>) {
  const db = getFirestore();
  const cfg = await requireSigninConfig(db, 'send');
  requireAttestation(request, cfg);

  const data = (request.data ?? {}) as Record<string, unknown>;
  if (data.purpose !== undefined && data.purpose !== 'signin') throw new HttpsError('invalid-argument', 'purpose-invalid');
  const requestId = typeof data.requestId === 'string' && REQUEST_ID_RE.test(data.requestId) ? data.requestId : null;
  if (!requestId) throw new HttpsError('invalid-argument', 'request-invalid');
  const num = normalizeLinkNumber(data.phoneE164);
  if (!num) throw new HttpsError('invalid-argument', 'number-not-supported');

  const pepper = requirePepper();
  const sessionKey = sessionKeyFor(pepper, data.sessionToken);
  if (!sessionKey) throw new HttpsError('failed-precondition', 'session-expired');

  // Store-review number (admin-configured, time-boxed): no SMS is ever queued
  // for it; the reviewer receives the code out of band. Same budgets apply.
  const isReview = !!cfg.review && cfg.review.phoneE164 === num.e164;
  if (!isReview) {
    const relays = await loadActiveRelayDevices(cfg.businessId!);
    if (!hasRelayCoverageForCountry(relays, num.countryCode, Date.now())) {
      throw new HttpsError('failed-precondition', 'no-relay-for-country');
    }
  }

  const L = cfg.limits;
  const now = Date.now();
  const destKey = phoneHmac(pepper, num.e164);
  const srcKey = sourceKeyFor(request, pepper, cfg.sourceHopsFromRight);
  const challengeId = newChallengeId();
  const code = generateCode();
  const verifier = codeVerifier(pepper, { challengeId, uid: sessionKey, purpose: 'signin', phoneKey: destKey }, code);
  const jobId = `pauth_${challengeId}`;
  const expiresAtMs = now + L.codeTtlSec * 1000;
  const resendAfterSec = Math.max(L.sessionCooldownSec, L.destinationCooldownSec);

  const sessRef = db.collection(C.sessions).doc(sessionKey);
  const destRef = db.collection(C.limits).doc(`dest_${destKey}`);
  const srcRef = db.collection(C.limits).doc(`asrc_${srcKey}`);
  const globRef = db.collection(C.limits).doc(SIGNIN_GLOBAL_COUNTER_ID);
  const sharedRef = db.collection(C.limits).doc(SHARED_COUNTER_ID);
  const chRef = db.collection(C.challenges).doc(challengeId);
  const jobRef = db.collection('relayJobs').doc(jobId);

  const out = await db.runTransaction<TxOut>(async tx => {
    const sessS = await tx.get(sessRef);
    if (!sessS.exists || (sessS.get('expiresAtMs') as number) <= now) {
      return { kind: 'error', code: 'session-expired', httpCode: 'failed-precondition' };
    }
    const sess = sessS.data()!;
    const installKey = (sess.installKey as string | null) ?? null;
    const instRef = installKey ? db.collection(C.limits).doc(`ainst_${installKey}`) : null;
    const prevChRef = sess.activeChallengeId ? db.collection(C.challenges).doc(sess.activeChallengeId as string) : null;
    const reads = await tx.getAll(destRef, srcRef, globRef, sharedRef, ...(instRef ? [instRef] : []), ...(prevChRef ? [prevChRef] : []));
    const [destS, srcS, globS, sharedS] = reads;
    const instS = instRef ? reads[4] : null;
    const prevChS = prevChRef ? reads[instRef ? 5 : 4] : null;
    const prevJobId = prevChS?.exists ? (prevChS.get('jobId') as string | null) : null;
    const prevJobRef = prevJobId ? db.collection('relayJobs').doc(prevJobId) : null;
    const prevJobS = prevJobRef ? await tx.get(prevJobRef) : null;

    // Idempotent retry of the SAME logical request (lost response): return the
    // original result. Never re-sends, never re-counts, needs no new proof.
    const last = sess.lastRequest as { requestId: string; destKey: string; response: CachedResponse } | null;
    const currentPow = sess.pow as PowState;
    if (last && last.requestId === requestId) {
      if (last.destKey !== destKey) return { kind: 'error', code: 'request-conflict', httpCode: 'failed-precondition', pow: currentPow };
      return { kind: 'replay', response: last.response, pow: currentPow };
    }

    // Proof-of-work: single use. Whatever happens next, rotate the nonce.
    const glob = (globS.data() ?? {}) as WindowCounter;
    const nextPow: PowState = {
      nonce: newPowNonce(),
      bits: adaptiveBits(L.powBits, L.powMaxBits, windowCount(glob.h, now, HOUR_MS), L.globalPerHour),
      expiresAtMs: Math.min(sess.expiresAtMs as number, now + L.powTtlSec * 1000),
    };
    const powOk = !!currentPow && currentPow.nonce === data.powNonce && currentPow.expiresAtMs > now
      && verifyPow(currentPow.nonce, num.e164, data.powSolution, currentPow.bits);
    if (!powOk) {
      tx.update(sessRef, { pow: nextPow, updatedAt: FieldValue.serverTimestamp() });
      return { kind: 'error', code: 'proof-invalid', httpCode: 'permission-denied', pow: nextPow };
    }

    const refuse = (rej: LimitRejection): TxOut => {
      tx.update(sessRef, { pow: nextPow, updatedAt: FieldValue.serverTimestamp() });
      return { kind: 'error', code: rej.code, httpCode: 'resource-exhausted', pow: nextPow, rej };
    };

    // Session.
    const dests = (sess.dests as string[]) ?? [];
    const lastCodeAt = (sess.lastCodeAt as number) ?? 0;
    if (lastCodeAt && lastCodeAt + L.sessionCooldownSec * 1000 > now) {
      return refuse({ code: 'cooldown', scope: 'session', retryAfterSec: Math.ceil((lastCodeAt + L.sessionCooldownSec * 1000 - now) / 1000) });
    }
    if (((sess.codes as number) ?? 0) >= L.sessionMaxCodes) return refuse({ code: 'session-exhausted', scope: 'session', retryAfterSec: 0 });
    if (!dests.includes(destKey) && dests.length >= L.sessionMaxDestinations) return refuse({ code: 'too-many-numbers', scope: 'session', retryAfterSec: 0 });

    // Installation (untrusted, resettable) — one layer among several.
    const inst = (instS?.data() ?? {}) as DistinctCounter;
    if (instRef) {
      const r = checkWindows(inst, now, L.installPerDay, L.installPerDay, 'installation', 'rate-limited')
        ?? checkDistinctPerDay(inst, destKey, now, L.installDistinctDestinationsPerDay, 'installation');
      if (r) return refuse(r);
    }

    // Source, destination, global, shared.
    const src = (srcS.data() ?? {}) as DistinctCounter;
    const dest = (destS.data() ?? {}) as DestinationCounter;
    const shared = (sharedS.data() ?? {}) as WindowCounter;
    const r = checkWindows(src, now, L.sourcePerHour, L.sourcePerDay, 'source')
      ?? checkDistinctPerDay(src, destKey, now, L.sourceDistinctDestinationsPerDay, 'source')
      ?? checkDestination(dest, now, L)
      ?? checkWindows(glob, now, L.globalPerHour, L.globalPerDay, 'global')
      ?? checkWindows(shared, now, cfg.sharedPerHour, cfg.sharedPerDay, 'global');
    if (r) return refuse(r);

    // ── Admit: counters, session, challenge, exactly one job. ─────────────
    const meta = { updatedAt: FieldValue.serverTimestamp(), expireAt: Timestamp.fromMillis(now + 31 * DAY_MS) };
    tx.set(destRef, { ...applyDestination(dest, now), ...meta });
    tx.set(srcRef, { ...applyDistinctPerDay(src, destKey, now), ...meta });
    tx.set(globRef, { ...applyWindows(glob, now), ...meta });
    tx.set(sharedRef, { ...applyWindows(shared, now), ...meta });
    if (instRef) tx.set(instRef, { ...applyDistinctPerDay(inst, destKey, now), ...meta });

    // One active code per session: supersede the previous one (its verifier
    // is dropped; its SMS is cancelled if no device took it yet, and the relay
    // refuses to send it at the final authorization step otherwise).
    if (prevChS?.exists && prevChS.get('status') === 'pending') {
      tx.update(prevChS.ref, { status: 'superseded', codeVerifier: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    }
    if (prevJobS?.exists && prevJobS.get('status') === 'queued') {
      tx.update(prevJobS.ref, {
        status: 'failed', failedAt: FieldValue.serverTimestamp(), lastError: 'superseded',
        messageBody: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(),
      });
    }

    const response: CachedResponse = { challengeId, expiresAtMs, resendAfterSec, maskedPhone: maskPhone(num.e164) };
    tx.update(sessRef, {
      pow: nextPow,
      codes: FieldValue.increment(1),
      dests: dests.includes(destKey) ? dests : [...dests, destKey],
      lastCodeAt: now,
      activeChallengeId: challengeId,
      lastRequest: { requestId, destKey, response },
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(chRef, {
      challengeId, purpose: 'signin', sessionKey,
      phoneKey: destKey, phoneE164: num.e164, countryCode: num.countryCode,
      codeVerifier: isReview ? null : verifier, review: isReview,
      attempts: 0, maxAttempts: L.maxVerifyAttempts,
      status: 'pending', jobId: isReview ? null : jobId, policyVersion: cfg.policyVersion,
      sourceTag: auditTag(srcKey), appCheckPresent: !!request.app,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(expiresAtMs), expiresAtMs,
      expireAt: Timestamp.fromMillis(expiresAtMs + DAY_MS),
    });
    if (!isReview) tx.create(jobRef, {
      jobId, businessId: cfg.businessId, kind: PHONE_AUTH_JOB_KIND,
      purpose: 'signin', policyVersion: cfg.policyVersion,
      challengeId, challengePath: chRef.path,
      batchId: null, recipientUid: null,
      phoneE164: num.e164, recipientCountryCode: num.countryCode,
      messageBody: buildSigninMessage(code, cfg.androidAppHash),
      assignedDeviceId: null, assignedSimSubscriptionId: null,
      status: 'queued', attempts: 0, maxAttempts: 1,
      leaseOwnerDeviceId: null, leaseExpiresAt: null, nextAttemptAt: null,
      expiresAt: Timestamp.fromMillis(expiresAtMs),
      traceId: jobId,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    return { kind: 'queued', response, pow: nextPow };
  });

  if (out.kind === 'error') {
    console.warn('[phoneAuth] request refused', {
      reason: out.code, scope: out.rej?.scope ?? null, source: auditTag(srcKey), dest: auditTag(destKey),
    });
    throw new HttpsError(out.httpCode, out.code, {
      ...(out.rej ? { retryAfterSec: out.rej.retryAfterSec, scope: out.rej.scope } : {}),
      ...(out.pow ? { pow: out.pow } : {}),
    });
  }
  if (out.kind === 'replay') return { ...out.response, pow: out.pow, replayed: true };

  // Side effects only after the transaction committed (never inside a callback
  // that may retry). Wake is best-effort; devices also poll.
  if (!isReview) try {
    const devs = await db.collection('relayDevices')
      .where('businessId', '==', cfg.businessId).where('status', '==', 'active').limit(10).get();
    await Promise.all(devs.docs.map(d => {
      const token = d.get('fcmToken') as string | null;
      return token ? getMessaging().send({ token, data: { type: 'relay_wake', businessId: cfg.businessId! }, android: { priority: 'high' } }) : null;
    }).filter(Boolean) as Promise<unknown>[]);
  } catch { /* devices poll */ }

  await writeAuditLog({
    action: 'phoneAuth.code.queued', actor: { uid: 'anonymous' },
    target: { type: 'phoneHash', id: auditTag(destKey) }, result: 'success',
    metadata: { source: auditTag(srcKey), session: auditTag(sessionKey), job: challengeId, countryCode: num.countryCode, appCheck: !!request.app },
  });
  return { ...out.response, pow: out.pow };
}

export const requestPhoneAuthCode = onCall(
  { region: REGION, secrets: [PHONE_HASH_PEPPER], ...appCheckOptions({ replayProtected: true }) },
  handleRequestPhoneAuthCode,
);
