// Callables: verifyPhoneLinkOtp, resumePhoneLink — prove possession of the
// number and attach it to the CALLER'S EXISTING account.
//
// No account is created or merged and nothing else on the account changes: the
// uid, conversations, memberships, wallet/points and profile stay as they are.
// The only writes on success are the private phone field, the public
// `phoneVerified` flag, the ownership claim and the link-op record.
//
// The challenge is looked up by the caller's uid (phoneLinkChallenges/{uid}),
// so another user's challenge can never be addressed, and the destination
// number comes from the challenge — the client cannot substitute a different
// number at verification time.
//
// Link state machine (phoneLinkOps/{uid}.stage), each step idempotent:
//   claimed      — code verified; phoneClaims/{phoneHmac} reserved for uid
//   auth-updated — Firebase Auth user carries the number
//   done         — private profile + phoneVerified written; claim active
//   failed       — number turned out unavailable; claim released
// If anything fails after `claimed`, the client gets `link-interrupted` and
// calls resumePhoneLink (or retries verify with the same challengeId), which
// continues from the recorded stage without a new code or a new SMS.

import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { appCheckOptions } from '../lib/appCheck';
import { writeAuditLog } from '../lib/auditLog';
import { userPrivateProfileRef } from '../lib/userPrivate';
import { requireConfig, requireEligibleCaller, PHONE_LINK_COLLECTIONS as C } from './gates';
import { REGION, PHONE_HASH_PEPPER, requirePepper, staleClaimOwner, authErrorCode } from './shared';
import { PHONE_LINK_PURPOSE, verifyCode, auditTag, maskPhone } from './crypto';
import { verifyFailuresExhausted, applyVerifyFailure, type AccountCounter } from './limits';

/**
 * Seams for adversarial tests (interruption between Auth and Firestore). Not
 * reachable by clients; production never reassigns them.
 */
export const phoneLinkDeps = {
  setAuthPhone: async (uid: string, e164: string): Promise<void> => {
    await getAuth().updateUser(uid, { phoneNumber: e164 });
  },
  beforeFinalize: async (_uid: string): Promise<void> => { /* no-op */ },
};

const CHALLENGE_ID_RE = /^[0-9a-f]{32}$/;
const CODE_RE = /^\d{6}$/;

type VerifyTx =
  | { kind: 'proceed' }
  | { kind: 'error'; code: string; attemptsLeft?: number };

export async function handleVerifyPhoneLinkOtp(request: CallableRequest<unknown>) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'auth-required');
  const db = getFirestore();
  const cfg = await requireConfig(db);
  if (!cfg.enabled) throw new HttpsError('failed-precondition', 'phone-link-disabled');

  const data = (request.data ?? {}) as Record<string, unknown>;
  if (data.purpose !== undefined && data.purpose !== PHONE_LINK_PURPOSE) {
    throw new HttpsError('invalid-argument', 'purpose-invalid');
  }
  // A verify may legitimately come up to one code-lifetime after the fresh
  // sign-in that requested it.
  const caller = await requireEligibleCaller(request, db, cfg.limits.reauthMaxAgeSec + cfg.limits.codeTtlSec);
  const uid = caller.uid;

  const challengeId = typeof data.challengeId === 'string' ? data.challengeId : '';
  const code = typeof data.code === 'string' ? data.code.trim() : '';
  if (!CHALLENGE_ID_RE.test(challengeId)) throw new HttpsError('not-found', 'challenge-not-found');
  if (!CODE_RE.test(code)) throw new HttpsError('invalid-argument', 'code-invalid');
  const pepper = requirePepper();

  const chRef = db.collection(C.challenges).doc(uid);
  const acctRef = db.collection(C.limits).doc(`acct_${uid}`);
  const opRef = db.collection(C.ops).doc(uid);

  // Stale-owner check needs Auth, which can't run inside the transaction.
  const pre = await chRef.get();
  const preKey = pre.exists ? (pre.get('phoneKey') as string | undefined) : undefined;
  const staleOwner = preKey ? await staleClaimOwner(db, preKey, uid) : null;

  const now = Date.now();
  const L = cfg.limits;

  const res = await db.runTransaction<VerifyTx>(async tx => {
    const [chS, acctS, opS] = await tx.getAll(chRef, acctRef, opRef);
    const op = opS.exists ? opS.data()! : null;
    // A retry of THIS challenge after the code was accepted (lost response,
    // interruption, duplicate tap) continues/returns the link idempotently —
    // it never re-checks a code, sends an SMS or changes anything new.
    // `failed` maps to the same generic refusal the first call returned.
    const opOfThis = !!op && op.challengeId === challengeId;
    const afterAccept = (): VerifyTx => (op!.stage === 'failed'
      ? { kind: 'error', code: 'phone-unavailable' } : { kind: 'proceed' });

    if (!chS.exists || chS.get('challengeId') !== challengeId) {
      return opOfThis ? afterAccept() : { kind: 'error', code: 'challenge-not-found' };
    }
    const ch = chS.data()!;
    const claimRef = db.collection(C.claims).doc(ch.phoneKey as string);
    const claimS = await tx.get(claimRef);

    if (ch.status !== 'pending') {
      if (ch.status === 'used' && opOfThis) return afterAccept();
      return { kind: 'error', code: ch.status === 'expired' ? 'code-expired' : 'challenge-not-found' };
    }
    if (ch.uid !== uid || ch.purpose !== PHONE_LINK_PURPOSE) return { kind: 'error', code: 'challenge-not-found' };

    const expiresAtMs = (ch.expiresAt as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (expiresAtMs <= now) {
      tx.update(chRef, { status: 'expired', codeVerifier: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
      return { kind: 'error', code: 'code-expired' };
    }
    const attempts = (ch.attempts as number) ?? 0;
    const maxAttempts = (ch.maxAttempts as number) ?? L.maxVerifyAttempts;
    const acct = (acctS.data() ?? {}) as AccountCounter;
    if (attempts >= maxAttempts || verifyFailuresExhausted(acct, now, L)) {
      return { kind: 'error', code: 'too-many-attempts' };
    }

    const binding = { challengeId, uid, purpose: PHONE_LINK_PURPOSE, phoneKey: ch.phoneKey as string };
    if (!verifyCode(pepper, binding, code, ch.codeVerifier as string)) {
      const next = attempts + 1;
      const burned = next >= maxAttempts;
      tx.update(chRef, {
        attempts: next,
        ...(burned ? { status: 'locked', codeVerifier: FieldValue.delete() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(acctRef, { ...applyVerifyFailure(acct, now), updatedAt: FieldValue.serverTimestamp() });
      return burned ? { kind: 'error', code: 'too-many-attempts' } : { kind: 'error', code: 'code-invalid', attemptsLeft: maxAttempts - next };
    }

    // Correct code: single use from here on, whatever happens next.
    tx.update(chRef, { status: 'used', usedAt: FieldValue.serverTimestamp(), codeVerifier: FieldValue.delete() });

    const claimUid = claimS.exists ? (claimS.get('uid') as string | undefined) : undefined;
    if (claimUid && claimUid !== uid && claimUid !== staleOwner) {
      return { kind: 'error', code: 'phone-unavailable' };
    }
    tx.set(claimRef, {
      uid, state: 'pending', challengeId,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(opRef, {
      uid, stage: 'claimed', challengeId,
      phoneKey: ch.phoneKey, phoneE164: ch.phoneE164,
      startedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    return { kind: 'proceed' };
  });

  if (res.kind === 'error') {
    if (res.code === 'code-invalid') {
      throw new HttpsError('permission-denied', 'code-invalid', { attemptsLeft: res.attemptsLeft });
    }
    if (res.code === 'phone-unavailable') {
      await writeAuditLog({ action: 'phoneLink.verify.unavailable', actor: { uid }, target: { type: 'phoneHash', id: auditTag(preKey ?? '') }, result: 'failure' });
      throw new HttpsError('already-exists', 'phone-unavailable');
    }
    if (res.code === 'too-many-attempts') throw new HttpsError('resource-exhausted', 'too-many-attempts');
    if (res.code === 'code-expired') throw new HttpsError('deadline-exceeded', 'code-expired');
    throw new HttpsError('not-found', res.code);
  }
  return completeLink(uid);
}

/**
 * Drive phoneLinkOps/{uid} to `done`. Safe to call any number of times and
 * from any stage; never sends an SMS and never touches anything but the phone
 * fields, the claim and the op.
 */
export async function completeLink(uid: string): Promise<{ linked: true; maskedPhone: string }> {
  const db = getFirestore();
  const opRef = db.collection(C.ops).doc(uid);
  const op = await opRef.get();
  if (!op.exists) throw new HttpsError('not-found', 'challenge-not-found');
  const stage = op.get('stage') as string;
  if (stage === 'done') {
    const phone = (await userPrivateProfileRef(db, uid).get()).get('phoneNumber') as string | undefined;
    return { linked: true, maskedPhone: phone ? maskPhone(phone) : '•••' };
  }
  if (stage === 'failed') throw new HttpsError('already-exists', 'phone-unavailable');

  const e164 = op.get('phoneE164') as string;
  const phoneKey = op.get('phoneKey') as string;
  const challengeId = op.get('challengeId') as string;
  const claimRef = db.collection(C.claims).doc(phoneKey);

  // Step 1 → auth-updated. Auth enforces global phone uniqueness itself, which
  // backs up the claim for numbers held by legacy (pre-claim) accounts.
  try {
    await phoneLinkDeps.setAuthPhone(uid, e164);
  } catch (e) {
    const code = authErrorCode(e);
    if (code === 'auth/phone-number-already-exists' || code === 'auth/invalid-phone-number') {
      let ownedBySelf = false;
      try { ownedBySelf = (await getAuth().getUserByPhoneNumber(e164)).uid === uid; } catch { /* not ours */ }
      if (!ownedBySelf) {
        await releaseFailedLink(uid, phoneKey, challengeId);
        await writeAuditLog({ action: 'phoneLink.link.unavailable', actor: { uid }, target: { type: 'phoneHash', id: auditTag(phoneKey) }, result: 'failure' });
        throw new HttpsError('already-exists', 'phone-unavailable');
      }
    } else {
      await opRef.update({ lastError: code || 'auth-update-failed', updatedAt: FieldValue.serverTimestamp() }).catch(() => {});
      console.warn('[phoneLink] auth update interrupted', { uid, code });
      throw new HttpsError('unavailable', 'link-interrupted');
    }
  }
  await opRef.update({ stage: 'auth-updated', updatedAt: FieldValue.serverTimestamp() }).catch(() => {});

  // Step 2 → done, atomically.
  try {
    await phoneLinkDeps.beforeFinalize(uid);
    await db.runTransaction(async tx => {
      const [opS, claimS] = await tx.getAll(opRef, claimRef);
      if (!opS.exists || opS.get('challengeId') !== challengeId) throw new Error('op-changed');
      if (opS.get('stage') === 'done') return;
      if (!claimS.exists || claimS.get('uid') !== uid) throw new Error('claim-lost');
      tx.set(userPrivateProfileRef(db, uid), {
        phoneNumber: e164, phoneVerifiedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.set(db.collection('users').doc(uid), { phoneVerified: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.update(claimRef, { state: 'active', linkedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      tx.update(opRef, {
        stage: 'done', completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        phoneE164: FieldValue.delete(), lastError: FieldValue.delete(),
      });
    });
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    await opRef.update({ lastError: 'finalize-failed', updatedAt: FieldValue.serverTimestamp() }).catch(() => {});
    console.warn('[phoneLink] finalize interrupted', { uid, reason: (e as Error)?.message });
    throw new HttpsError('unavailable', 'link-interrupted');
  }

  await writeAuditLog({ action: 'phoneLink.linked', actor: { uid }, target: { type: 'phoneHash', id: auditTag(phoneKey) }, result: 'success' });
  return { linked: true, maskedPhone: maskPhone(e164) };
}

async function releaseFailedLink(uid: string, phoneKey: string, challengeId: string): Promise<void> {
  const db = getFirestore();
  const opRef = db.collection(C.ops).doc(uid);
  const claimRef = db.collection(C.claims).doc(phoneKey);
  await db.runTransaction(async tx => {
    const [opS, claimS] = await tx.getAll(opRef, claimRef);
    if (claimS.exists && claimS.get('uid') === uid && claimS.get('challengeId') === challengeId) tx.delete(claimRef);
    if (opS.exists && opS.get('challengeId') === challengeId) {
      tx.update(opRef, { stage: 'failed', reason: 'unavailable', phoneE164: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    }
  });
}

export async function handleResumePhoneLink(request: CallableRequest<unknown>) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'auth-required');
  const db = getFirestore();
  const cfg = await requireConfig(db);
  if (!cfg.enabled) throw new HttpsError('failed-precondition', 'phone-link-disabled');
  const caller = await requireEligibleCaller(request, db, cfg.limits.reauthMaxAgeSec);
  return completeLink(caller.uid);
}

export const verifyPhoneLinkOtp = onCall(
  { region: REGION, secrets: [PHONE_HASH_PEPPER], ...appCheckOptions() },
  handleVerifyPhoneLinkOtp,
);

export const resumePhoneLink = onCall(
  { region: REGION, ...appCheckOptions() },
  handleResumePhoneLink,
);
