// Callables: verifyEmailChangeCode, resumeEmailChange — prove control of the new
// address and attach it to the CALLER'S EXISTING account (adding it, or
// replacing the current one).
//
// No account is created or merged and nothing else changes: the uid,
// conversations, memberships, wallet/points and roles stay as they are. If the
// address already belongs to another account the change is refused with the
// generic `email-unavailable` — accounts are never merged automatically.
//
// The current address keeps working until the new one is verified. Once the
// change completes, the Auth record carries only the new address, so the old
// one no longer signs in to this account (email-code and password sign-in both
// resolve the account through the Auth record).
//
// State machine (emailChangeOps/{uid}.stage), each step idempotent:
//   verified     — code accepted (challenge consumed, single use)
//   auth-updated — Firebase Auth user carries the new, verified address
//   done         — private profile + emailVerified written
//   failed       — address turned out to belong to another account
// After an interruption the client gets `change-interrupted` and calls
// resumeEmailChange with the same challengeId (or retries verify); this
// continues from the recorded stage without a new code or a new email.
//
// Stale workers: Firebase Auth has no compare-and-set, and a request timeout
// does not stop a worker that is still running. Every Auth write is therefore
// recorded before it is sent and resolved after it returns (./authWrites.ts):
// no new change is accepted while a write is pending; a write that lost to a
// newer change marks it dirty (it re-writes before finalizing) or is undone
// once settled; and writes of unknown outcome are reconciled durably.

import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, type Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { appCheckOptions } from '../lib/appCheck';
import { writeAuditLog } from '../lib/auditLog';
import { userPrivateProfileRef } from '../lib/userPrivate';
import { emailKey as keyOf } from '../auth/emailOtpLogic';
import { requireEligibleCaller } from '../phoneLink/gates';
import { authErrorCode } from '../phoneLink/shared';
import {
  EMAIL_CHANGE_COLLECTIONS as C, EMAIL_CHANGE_LIMITS as L, EMAIL_CHANGE_PURPOSE, EMAIL_CHANGE_FN_TIMEOUT_SEC,
  emailChangeCodeMatches, emailChangeVerifyExhausted, applyEmailChangeVerifyFailure, maskEmail,
  recoveryAllowed, recoveryKeyHash, RECOVERY_KEY_RE,
  type EmailChangeAccountCounter,
} from './logic';
import {
  authWriteDeps, ledgerRef, liveWrites, newWriteId, recordPending, resolvePending, writeOutcomeUnknown,
  reconcileAuthEmail, settleUncertain, type Ledger,
} from './authWrites';

const REGION = 'us-central1';
const CHALLENGE_ID_RE = /^[0-9a-f]{32}$/;
const CODE_RE = /^\d{6}$/;
const NONTERMINAL = new Set(['verified', 'auth-updated']);

/** Seams for adversarial tests (interruptions). Production never reassigns them. */
export const emailChangeDeps = {
  /** The Auth write itself lives in authWriteDeps (shared with repairs). */
  get setAuthEmail() { return authWriteDeps.setAuthEmail; },
  set setAuthEmail(f: (uid: string, email: string) => Promise<void>) { authWriteDeps.setAuthEmail = f; },
  beforeAuthWrite: async (_uid: string): Promise<void> => { /* no-op */ },
  beforeFinalize: async (_uid: string): Promise<void> => { /* no-op */ },
  /** Between finalize's Auth read and its Firestore transaction. */
  afterAuthCheck: async (_uid: string): Promise<void> => { /* no-op */ },
};

const ms = (v: unknown): number => (v as Timestamp | undefined)?.toMillis?.() ?? 0;

/**
 * The eligible caller — or, ONLY to finish the change it had accepted, the same
 * device after Firebase revoked its session because of that change (the email
 * update signs out every session). That device must present the challenge and
 * the recovery key it sent with the verify; the revocation must be the one this
 * change caused, with none since; and the account must still be in good
 * standing (enabled, not suspended). Each recovery use is counted.
 */
async function callerForChange(
  request: CallableRequest<unknown>, challengeId: string, recoveryKey: string | null,
): Promise<{ uid: string; email: string | null }> {
  const db = getFirestore();
  try {
    const c = await requireEligibleCaller(request, db, L.reauthMaxAgeSec + L.codeTtlSec);
    return { uid: c.uid, email: c.user.email ?? null };
  } catch (e) {
    if (!(e instanceof HttpsError) || e.message !== 'reauth-required') throw e;
    if (!recoveryKey || !CHALLENGE_ID_RE.test(challengeId)) throw e;
    // Same standing checks as any caller, minus session freshness.
    const c = await requireEligibleCaller(request, db, 0, Date.now(), { skipFreshness: true });
    const opRef = db.collection(C.ops).doc(c.uid);
    const authTimeSec = (request.auth!.token as { auth_time?: number }).auth_time;
    const ok = await db.runTransaction(async tx => {
      const s = await tx.get(opRef);
      const op = s.exists ? s.data()! : null;
      const allowed = recoveryAllowed({
        op: op ? { ...op, startedAtMs: ms(op.startedAt) } : null,
        uid: c.uid, challengeId, recoveryKey, authTimeSec,
        tokensValidAfterTime: c.user.tokensValidAfterTime, nowMs: Date.now(),
      });
      if (allowed) tx.update(opRef, { recoveryUses: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() });
      return allowed;
    });
    if (!ok) throw e;
    return { uid: c.uid, email: c.user.email ?? null };
  }
}

const readRecoveryKey = (v: unknown): string | null => (typeof v === 'string' && RECOVERY_KEY_RE.test(v) ? v : null);


type VerifyTx = { kind: 'proceed' } | { kind: 'error'; code: string; attemptsLeft?: number; retryAfterSec?: number };

export async function handleVerifyEmailChangeCode(request: CallableRequest<unknown>) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'auth-required');
  const data = (request.data ?? {}) as Record<string, unknown>;
  if (data.purpose !== undefined && data.purpose !== EMAIL_CHANGE_PURPOSE) throw new HttpsError('invalid-argument', 'purpose-invalid');
  const db = getFirestore();
  const challengeId = typeof data.challengeId === 'string' ? data.challengeId : '';
  const code = typeof data.code === 'string' ? data.code.trim() : '';
  if (data.recoveryKey !== undefined && readRecoveryKey(data.recoveryKey) === null) throw new HttpsError('invalid-argument', 'recovery-invalid');
  const recoveryKey = readRecoveryKey(data.recoveryKey);
  // A verify may legitimately arrive up to one code-lifetime after the fresh sign-in.
  const caller = await callerForChange(request, challengeId, recoveryKey);
  const uid = caller.uid;
  if (!CHALLENGE_ID_RE.test(challengeId)) throw new HttpsError('not-found', 'challenge-not-found');
  if (!CODE_RE.test(code)) throw new HttpsError('invalid-argument', 'code-invalid');

  await settleUncertain(uid);
  const chRef = db.collection(C.challenges).doc(uid);
  const opRef = db.collection(C.ops).doc(uid);
  const acctRef = db.collection(C.limits).doc(`acct_${uid}`);
  const now = Date.now();
  const previousEmail = caller.email;

  let res: VerifyTx;
  try {
    res = await db.runTransaction<VerifyTx>(async tx => {
      const [chS, opS, acctS, lS] = await tx.getAll(chRef, opRef, acctRef, ledgerRef(db, uid));
      const op = opS.exists ? opS.data()! : null;
      const opOfThis = !!op && op.challengeId === challengeId;
      // A retry of THIS challenge after acceptance continues idempotently.
      const afterAccept = (): VerifyTx => (op!.stage === 'failed' ? { kind: 'error', code: 'email-unavailable' } : { kind: 'proceed' });

      if (!chS.exists || chS.get('challengeId') !== challengeId) {
        return opOfThis ? afterAccept() : { kind: 'error', code: 'challenge-not-found' };
      }
      const ch = chS.data()!;
      if (ch.status !== 'pending') {
        if (ch.status === 'used' && opOfThis) return afterAccept();
        return { kind: 'error', code: ch.status === 'expired' ? 'code-expired' : ch.status === 'locked' ? 'too-many-attempts' : 'challenge-not-found' };
      }
      if (ch.uid !== uid || ch.purpose !== EMAIL_CHANGE_PURPOSE) return { kind: 'error', code: 'challenge-not-found' };
      if (op && NONTERMINAL.has(op.stage)) return { kind: 'error', code: 'change-pending-recovery' };
      // An earlier Auth write is still in flight: it must resolve first.
      const live = liveWrites(lS.exists ? (lS.data() as Ledger) : undefined, now);
      if (live.count) return { kind: 'error', code: 'change-settling', retryAfterSec: live.retryAfterSec };

      const expiresAtMs = (ch.expiresAt as Timestamp | undefined)?.toMillis?.() ?? 0;
      if (expiresAtMs <= now) {
        tx.update(chRef, { status: 'expired', codeHash: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
        return { kind: 'error', code: 'code-expired' };
      }
      const attempts = (ch.attempts as number) ?? 0;
      const maxAttempts = (ch.maxAttempts as number) ?? L.maxVerifyAttempts;
      const acct = (acctS.data() ?? {}) as EmailChangeAccountCounter;
      if (attempts >= maxAttempts || emailChangeVerifyExhausted(acct, now)) return { kind: 'error', code: 'too-many-attempts' };

      const binding = { challengeId, uid, emailKey: ch.emailKey as string };
      if (!emailChangeCodeMatches(binding, code, ch.salt, ch.codeHash)) {
        const next = attempts + 1;
        const burned = next >= maxAttempts;
        tx.update(chRef, {
          attempts: next, ...(burned ? { status: 'locked', codeHash: FieldValue.delete() } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.set(acctRef, { ...applyEmailChangeVerifyFailure(acct, now), updatedAt: FieldValue.serverTimestamp() });
        return burned ? { kind: 'error', code: 'too-many-attempts' } : { kind: 'error', code: 'code-invalid', attemptsLeft: maxAttempts - next };
      }

      // Correct code: single use from here on, whatever happens next.
      tx.update(chRef, { status: 'used', usedAt: FieldValue.serverTimestamp(), codeHash: FieldValue.delete() });
      tx.set(opRef, {
        uid, stage: 'verified', challengeId, email: ch.email, emailKey: ch.emailKey,
        previousEmailKey: previousEmail ? keyOf(previousEmail.toLowerCase()) : null,
        recoveryHash: recoveryKey ? recoveryKeyHash(recoveryKey) : null, recoveryUses: 0,
        startedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      return { kind: 'proceed' };
    });
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.warn('[emailChange] verify transaction failed; reporting change-interrupted', { uid });
    throw new HttpsError('unavailable', 'change-interrupted');
  }

  if (res.kind === 'error') {
    if (res.code === 'code-invalid') throw new HttpsError('permission-denied', 'code-invalid', { attemptsLeft: res.attemptsLeft });
    if (res.code === 'email-unavailable') throw new HttpsError('already-exists', 'email-unavailable');
    if (res.code === 'too-many-attempts') throw new HttpsError('resource-exhausted', 'too-many-attempts');
    if (res.code === 'code-expired') throw new HttpsError('deadline-exceeded', 'code-expired');
    if (res.code === 'change-settling') throw new HttpsError('resource-exhausted', 'change-settling', { retryAfterSec: res.retryAfterSec });
    if (res.code === 'change-pending-recovery') throw new HttpsError('failed-precondition', 'change-pending-recovery');
    throw new HttpsError('not-found', res.code);
  }
  return completeEmailChange(uid, challengeId);
}

async function advanceOp(uid: string, challengeId: string, from: string[], patch: Record<string, unknown>): Promise<boolean> {
  const db = getFirestore();
  const opRef = db.collection(C.ops).doc(uid);
  return db.runTransaction(async tx => {
    const s = await tx.get(opRef);
    if (!s.exists || s.get('challengeId') !== challengeId || !from.includes(s.get('stage'))) return false;
    tx.update(opRef, { ...patch, updatedAt: FieldValue.serverTimestamp() });
    return true;
  });
}

async function failOp(uid: string, challengeId: string): Promise<void> {
  await advanceOp(uid, challengeId, [...NONTERMINAL], { stage: 'failed', reason: 'unavailable', email: FieldValue.delete() });
  await writeAuditLog({ action: 'emailChange.unavailable', actor: { uid }, target: { type: 'account', id: uid }, result: 'failure' });
}

/** Does a DIFFERENT live Auth user hold this address? */
async function heldByOther(uid: string, email: string): Promise<boolean> {
  try {
    return (await getAuth().getUserByEmail(email)).uid !== uid;
  } catch (e) {
    if (authErrorCode(e) === 'auth/user-not-found') return false;
    throw e;
  }
}

/**
 * Drive emailChangeOps/{uid} to `done`. Safe to call any number of times, from
 * any stage, by concurrent workers: every stage write is conditional on the
 * current stage and challenge, and it never sends an email.
 */
type ChangeResult = { changed: true; email: string; maskedEmail: string; customToken: string };

/** Firebase signs out existing sessions when the email changes; hand the
 *  device that made the change a token for its OWN account to continue. */
async function withToken(uid: string, email: string): Promise<ChangeResult> {
  let customToken: string;
  try { customToken = await getAuth().createCustomToken(uid); } catch { throw new HttpsError('unavailable', 'change-interrupted'); }
  return { changed: true, email, maskedEmail: email ? maskEmail(email) : '•••', customToken };
}

/**
 * Step 1's Auth write, recorded in the ledger before it is sent and resolved
 * after it returns. Records the revocation marker the write produced (the only
 * one revoked-session recovery accepts). A write that lost to a newer change
 * is handed to reconcileAuthEmail (dirty-mark or undo).
 */
async function fencedChangeWrite(uid: string, challengeId: string, email: string): Promise<boolean> {
  const db = getFirestore();
  const opRef = db.collection(C.ops).doc(uid);
  const lRef = ledgerRef(db, uid);
  const writeId = newWriteId();
  const claimAt = Date.now();
  const claimed = await db.runTransaction(async tx => {
    const [s, l] = await tx.getAll(opRef, lRef);
    if (!s.exists || s.get('challengeId') !== challengeId || s.get('stage') !== 'verified') return false;
    recordPending(tx, lRef, l.exists ? (l.data() as Ledger) : undefined, writeId, { email, challengeId, kind: 'change', atMs: claimAt });
    tx.update(opRef, { authClaimAtMs: claimAt, authDirty: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    return true;
  });
  if (!claimed) return false; // another worker moved it on; the caller re-reads the op
  // outcome: 'none' (never sent), 'unknown' (may still land), 'written' (landed).
  const resolve = (outcome: 'none' | 'unknown' | 'written', marker: string | null) => db.runTransaction(async tx => {
    const [s, l] = await tx.getAll(opRef, lRef);
    resolvePending(tx, lRef, l.exists ? (l.data() as Ledger) : undefined, writeId, outcome === 'unknown', Date.now());
    if (!s.exists || s.get('challengeId') !== challengeId) return outcome === 'none' ? 'ok' : 'stale';
    const st = s.get('stage');
    if (outcome === 'written' && (st === 'verified' || st === 'auth-updated')) {
      tx.update(opRef, { stage: 'auth-updated', changeValidAfter: marker, updatedAt: FieldValue.serverTimestamp() });
      return 'ok';
    }
    return st === 'failed' && outcome !== 'none' ? 'stale' : 'ok';
  });

  await emailChangeDeps.beforeAuthWrite(uid);
  if (Date.now() - claimAt > L.authWriteDeadlineMs) {
    await resolve('none', null);
    throw new HttpsError('unavailable', 'change-interrupted');
  }
  try {
    await authWriteDeps.setAuthEmail(uid, email);
  } catch (e) {
    const r = await resolve(writeOutcomeUnknown(e) ? 'unknown' : 'none', null);
    if (r === 'stale') await reconcileAuthEmail(uid);
    const code = authErrorCode(e);
    if (code === 'auth/email-already-exists' && await heldByOther(uid, email)) {
      await failOp(uid, challengeId);
      throw new HttpsError('already-exists', 'email-unavailable');
    }
    throw e;
  }
  let marker: string | null = null;
  try { marker = (await getAuth().getUser(uid)).tokensValidAfterTime ?? null; } catch { marker = null; }
  if (await resolve('written', marker) === 'stale') {
    // This write lost to a newer change: undo it (or make that change re-write).
    await reconcileAuthEmail(uid);
    throw new HttpsError('not-found', 'challenge-not-found');
  }
  return true;
}

export async function completeEmailChange(uid: string, challengeId: string, depth = 0): Promise<ChangeResult> {
  const db = getFirestore();
  const opRef = db.collection(C.ops).doc(uid);
  const op = await opRef.get();
  if (!op.exists || op.get('challengeId') !== challengeId) throw new HttpsError('not-found', 'challenge-not-found');
  const stage = op.get('stage') as string;
  if (stage === 'failed') throw new HttpsError('already-exists', 'email-unavailable');
  if (stage === 'done') {
    if (await reconcileAuthEmail(uid, { markDirty: false }) === 'unknown') throw new HttpsError('unavailable', 'change-interrupted');
    const email = (await userPrivateProfileRef(db, uid).get()).get('email') as string | undefined;
    return withToken(uid, email ?? '');
  }
  const email = op.get('email') as string;

  // Step 1 → auth-updated. Auth itself enforces that one address belongs to one
  // account, which settles a race between two accounts verifying one address.
  try {
    if (stage === 'verified') {
      if (await heldByOther(uid, email)) {
        await failOp(uid, challengeId);
        throw new HttpsError('already-exists', 'email-unavailable');
      }
      if (!await fencedChangeWrite(uid, challengeId, email)) {
        if (depth >= 2) throw new HttpsError('unavailable', 'change-interrupted');
        return completeEmailChange(uid, challengeId, depth + 1);
      }
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    await advanceOp(uid, challengeId, [...NONTERMINAL], { lastError: authErrorCode(e) || 'auth-update-failed' }).catch(() => false);
    console.warn('[emailChange] auth update interrupted', { uid, code: authErrorCode(e) });
    throw new HttpsError('unavailable', 'change-interrupted');
  }

  // Step 2 → done, atomically. The old address's pending sign-in code (if any)
  // is voided so it cannot be used after the change.
  try {
    await emailChangeDeps.beforeFinalize(uid);
    // A stale writer may have overwritten the address since step 1: send the
    // op back to `verified` so the fenced write runs again.
    const authEmail = ((await getAuth().getUser(uid)).email ?? '').toLowerCase();
    if (authEmail !== email.toLowerCase()) {
      await advanceOp(uid, challengeId, ['auth-updated'], { stage: 'verified' });
      throw new HttpsError('unavailable', 'change-interrupted');
    }
    await emailChangeDeps.afterAuthCheck(uid);
    const prevKey = op.get('previousEmailKey') as string | null;
    const fin = await db.runTransaction(async tx => {
      const opS = await tx.get(opRef);
      if (!opS.exists || opS.get('challengeId') !== challengeId) throw new Error('op-changed');
      if (opS.get('stage') === 'done') return 'done';
      if (!NONTERMINAL.has(opS.get('stage'))) throw new Error('op-terminal');
      // A stale write landed after the read above (its worker reported it):
      // the address must be written again before this change may finish.
      if (opS.get('authDirty') === true) {
        tx.update(opRef, { stage: 'verified', authDirty: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
        return 'dirty';
      }
      tx.set(userPrivateProfileRef(db, uid), {
        email, emailVerifiedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.set(db.collection('users').doc(uid), { emailVerified: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      if (prevKey && prevKey !== opS.get('emailKey')) tx.delete(db.collection('emailOtpChallenges').doc(prevKey));
      tx.update(opRef, {
        stage: 'done', completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        email: FieldValue.delete(), lastError: FieldValue.delete(),
      });
      return 'finalized';
    });
    if (fin === 'dirty') throw new HttpsError('unavailable', 'change-interrupted');
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    await opRef.update({ lastError: 'finalize-failed', updatedAt: FieldValue.serverTimestamp() }).catch(() => {});
    console.warn('[emailChange] finalize interrupted', { uid, reason: (e as Error)?.message });
    throw new HttpsError('unavailable', 'change-interrupted');
  }

  // Never report success while Auth carries another address: a write that
  // landed after the transaction is undone now (the change is the settled one).
  const after = await reconcileAuthEmail(uid, { markDirty: false });
  if (after === 'unknown') throw new HttpsError('unavailable', 'change-interrupted');

  await writeAuditLog({
    action: 'emailChange.completed', actor: { uid }, target: { type: 'account', id: uid }, result: 'success',
    metadata: { replaced: !!op.get('previousEmailKey') },
  });
  return withToken(uid, email);
}

export async function handleResumeEmailChange(request: CallableRequest<unknown>) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'auth-required');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const challengeId = typeof data.challengeId === 'string' ? data.challengeId : '';
  if (!CHALLENGE_ID_RE.test(challengeId)) throw new HttpsError('not-found', 'challenge-not-found');
  if (data.recoveryKey !== undefined && readRecoveryKey(data.recoveryKey) === null) throw new HttpsError('invalid-argument', 'recovery-invalid');
  const caller = await callerForChange(request, challengeId, readRecoveryKey(data.recoveryKey));
  return completeEmailChange(caller.uid, challengeId);
}

const FN_OPTS = { region: REGION, timeoutSeconds: EMAIL_CHANGE_FN_TIMEOUT_SEC, ...appCheckOptions() };
export const verifyEmailChangeCode = onCall(FN_OPTS, handleVerifyEmailChangeCode);
export const resumeEmailChange = onCall(FN_OPTS, handleResumeEmailChange);
