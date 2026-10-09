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
// resumeEmailChange (or retries verify with the same challengeId); this
// continues from the recorded stage without a new code or a new email.

import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, type Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { appCheckOptions } from '../lib/appCheck';
import { writeAuditLog } from '../lib/auditLog';
import { userPrivateProfileRef } from '../lib/userPrivate';
import { emailKey as keyOf } from '../auth/emailOtpLogic';
import { requireEligibleCaller, authFreshness } from '../phoneLink/gates';
import { authErrorCode } from '../phoneLink/shared';
import {
  EMAIL_CHANGE_COLLECTIONS as C, EMAIL_CHANGE_LIMITS as L, EMAIL_CHANGE_PURPOSE,
  emailChangeCodeMatches, emailChangeVerifyExhausted, applyEmailChangeVerifyFailure, maskEmail,
  type EmailChangeAccountCounter,
} from './logic';

const REGION = 'us-central1';
const CHALLENGE_ID_RE = /^[0-9a-f]{32}$/;
const CODE_RE = /^\d{6}$/;
const NONTERMINAL = new Set(['verified', 'auth-updated']);

/** Seams for adversarial tests (interruptions). Production never reassigns them. */
export const emailChangeDeps = {
  setAuthEmail: async (uid: string, email: string): Promise<void> => {
    await getAuth().updateUser(uid, { email, emailVerified: true });
  },
  beforeFinalize: async (_uid: string): Promise<void> => { /* no-op */ },
};

const RETRY_WINDOW_MS = 30 * 60 * 1000;

/**
 * The eligible caller — or, ONLY to finish a change this same sign-in already
 * had accepted, a caller whose token predates the change. Firebase revokes
 * existing sessions when an account's email changes, so a lost response after
 * the Auth update would otherwise strand the device: the retry may continue
 * (and receive a fresh token for its own account) when the op was accepted
 * after the token's sign-in, within a short window, for the same challenge.
 */
async function callerForChange(request: CallableRequest<unknown>, challengeId: string | null): Promise<{ uid: string; email: string | null }> {
  const db = getFirestore();
  try {
    const c = await requireEligibleCaller(request, db, L.reauthMaxAgeSec + L.codeTtlSec);
    return { uid: c.uid, email: c.user.email ?? null };
  } catch (e) {
    if (!(e instanceof HttpsError) || e.message !== 'reauth-required') throw e;
    const uid = request.auth!.uid;
    const authTime = (request.auth!.token as { auth_time?: number }).auth_time;
    const op = await db.collection(C.ops).doc(uid).get();
    const startedMs = (op.get('startedAt') as Timestamp | undefined)?.toMillis?.() ?? 0;
    const ok = op.exists && ['verified', 'auth-updated', 'done'].includes(op.get('stage'))
      && (challengeId === null || op.get('challengeId') === challengeId)
      && typeof authTime === 'number' && authTime * 1000 <= startedMs + 5_000
      && authFreshness(authTime, startedMs, L.reauthMaxAgeSec + L.codeTtlSec) === 'ok'
      && Date.now() - startedMs < RETRY_WINDOW_MS;
    if (!ok) throw e;
    const user = await getAuth().getUser(uid);
    if (user.disabled) throw new HttpsError('permission-denied', 'account-disabled');
    return { uid, email: user.email ?? null };
  }
}

type VerifyTx = { kind: 'proceed' } | { kind: 'error'; code: string; attemptsLeft?: number };

export async function handleVerifyEmailChangeCode(request: CallableRequest<unknown>) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'auth-required');
  const data = (request.data ?? {}) as Record<string, unknown>;
  if (data.purpose !== undefined && data.purpose !== EMAIL_CHANGE_PURPOSE) throw new HttpsError('invalid-argument', 'purpose-invalid');
  const db = getFirestore();
  const challengeId = typeof data.challengeId === 'string' ? data.challengeId : '';
  const code = typeof data.code === 'string' ? data.code.trim() : '';
  // A verify may legitimately arrive up to one code-lifetime after the fresh sign-in.
  const caller = await callerForChange(request, challengeId);
  const uid = caller.uid;
  if (!CHALLENGE_ID_RE.test(challengeId)) throw new HttpsError('not-found', 'challenge-not-found');
  if (!CODE_RE.test(code)) throw new HttpsError('invalid-argument', 'code-invalid');

  const chRef = db.collection(C.challenges).doc(uid);
  const opRef = db.collection(C.ops).doc(uid);
  const acctRef = db.collection(C.limits).doc(`acct_${uid}`);
  const now = Date.now();
  const previousEmail = caller.email;

  let res: VerifyTx;
  try {
    res = await db.runTransaction<VerifyTx>(async tx => {
      const [chS, opS, acctS] = await tx.getAll(chRef, opRef, acctRef);
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
    if (res.code === 'change-pending-recovery') throw new HttpsError('failed-precondition', 'change-pending-recovery');
    throw new HttpsError('not-found', res.code);
  }
  return completeEmailChange(uid);
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

export async function completeEmailChange(uid: string): Promise<ChangeResult> {
  const db = getFirestore();
  const opRef = db.collection(C.ops).doc(uid);
  const op = await opRef.get();
  if (!op.exists) throw new HttpsError('not-found', 'challenge-not-found');
  const stage = op.get('stage') as string;
  if (stage === 'failed') throw new HttpsError('already-exists', 'email-unavailable');
  if (stage === 'done') {
    const email = (await userPrivateProfileRef(db, uid).get()).get('email') as string | undefined;
    return withToken(uid, email ?? '');
  }
  const challengeId = op.get('challengeId') as string;
  const email = op.get('email') as string;

  // Step 1 → auth-updated. Auth itself enforces that one address belongs to one
  // account, which settles a race between two accounts verifying one address.
  try {
    if (stage === 'verified') {
      if (await heldByOther(uid, email)) {
        await failOp(uid, challengeId);
        throw new HttpsError('already-exists', 'email-unavailable');
      }
      try {
        await emailChangeDeps.setAuthEmail(uid, email);
      } catch (e) {
        const code = authErrorCode(e);
        if (code === 'auth/email-already-exists' && await heldByOther(uid, email)) {
          await failOp(uid, challengeId);
          throw new HttpsError('already-exists', 'email-unavailable');
        }
        throw e;
      }
      await advanceOp(uid, challengeId, ['verified'], { stage: 'auth-updated' });
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
    const prevKey = op.get('previousEmailKey') as string | null;
    await db.runTransaction(async tx => {
      const opS = await tx.get(opRef);
      if (!opS.exists || opS.get('challengeId') !== challengeId) throw new Error('op-changed');
      if (opS.get('stage') === 'done') return;
      if (!NONTERMINAL.has(opS.get('stage'))) throw new Error('op-terminal');
      tx.set(userPrivateProfileRef(db, uid), {
        email, emailVerifiedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.set(db.collection('users').doc(uid), { emailVerified: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      if (prevKey && prevKey !== opS.get('emailKey')) tx.delete(db.collection('emailOtpChallenges').doc(prevKey));
      tx.update(opRef, {
        stage: 'done', completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        email: FieldValue.delete(), lastError: FieldValue.delete(),
      });
    });
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    await opRef.update({ lastError: 'finalize-failed', updatedAt: FieldValue.serverTimestamp() }).catch(() => {});
    console.warn('[emailChange] finalize interrupted', { uid, reason: (e as Error)?.message });
    throw new HttpsError('unavailable', 'change-interrupted');
  }

  await writeAuditLog({
    action: 'emailChange.completed', actor: { uid }, target: { type: 'account', id: uid }, result: 'success',
    metadata: { replaced: !!op.get('previousEmailKey') },
  });
  return withToken(uid, email);
}

export async function handleResumeEmailChange(request: CallableRequest<unknown>) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'auth-required');
  const caller = await callerForChange(request, null);
  return completeEmailChange(caller.uid);
}

export const verifyEmailChangeCode = onCall({ region: REGION, ...appCheckOptions() }, handleVerifyEmailChangeCode);
export const resumeEmailChange = onCall({ region: REGION, ...appCheckOptions() }, handleResumeEmailChange);
