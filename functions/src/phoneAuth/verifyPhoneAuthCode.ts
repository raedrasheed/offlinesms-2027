// Callable: verifyPhoneAuthCode — check a sign-in code and return a Firebase
// custom token for the phone's account, creating the account if none exists.
// UNAUTHENTICATED by design.
//
// Binding: the challenge is addressed by its opaque id AND must belong to the
// caller's pre-auth session (HMAC of the bearer token), so someone who only
// knows the phone number can neither guess against it nor burn its attempts.
// Wrong codes are also counted per DESTINATION per day across every challenge
// and session, so new sessions don't buy new guesses.
//
// Completion is an explicit, monotonic state machine in phoneAuthOps/{challengeId}:
//   verified   — code accepted (challenge consumed, single use)
//   user-ready — the Auth user is resolved (existing, or created with a uid
//                planned BEFORE creation so a crash mid-create is recoverable)
//   done       — profile/wallet/private phone written; token may be issued
// Retrying verify with the same session + challenge continues from the stored
// stage (no new code, no SMS) and, once done, re-issues a token for a short
// window. The 50-point welcome credit is granted at most once, only for an
// account this flow created, guarded in the same transaction as the op.

import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { ReviewAccess, PhoneAuthConfig } from './config';
import { appCheckOptions } from '../lib/appCheck';
import { writeAuditLog } from '../lib/auditLog';
import { userPrivateProfileRef } from '../lib/userPrivate';
import { REGION, PHONE_HASH_PEPPER, requirePepper, authErrorCode } from '../phoneLink/shared';
import { verifyCode, auditTag } from '../phoneLink/crypto';
import {
  destinationVerifyExhausted, applyDestinationVerifyFailure, DAY_MS, type DestinationCounter,
} from '../phoneLink/limits';
import { profileIsActive } from '../phoneLink/gates';
import { PHONE_AUTH_COLLECTIONS as C, requireSigninConfig, requireAttestation, sessionKeyFor } from './shared';

const CHALLENGE_ID_RE = /^[0-9a-f]{32}$/;
const CODE_RE = /^\d{6}$/;

/** Seams for adversarial tests (interruptions). Production never reassigns them. */
export const phoneAuthDeps = {
  getUserByPhone: (e164: string) => getAuth().getUserByPhoneNumber(e164),
  createUser: (uid: string, e164: string) => getAuth().createUser({ uid, phoneNumber: e164 }),
  getUser: (uid: string) => getAuth().getUser(uid),
  mintToken: (uid: string) => getAuth().createCustomToken(uid),
  beforeBootstrap: async (_challengeId: string): Promise<void> => { /* no-op */ },
};

/** Constant-time check of a store-review code (salted SHA-256). */
export function reviewCodeMatches(review: ReviewAccess, code: string): boolean {
  const actual = createHash('sha256').update(`${review.codeSalt}:${code}`).digest();
  const expected = Buffer.from(review.codeHash, 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

/** Firebase-style uid chosen before createUser so a retry can recognise it. */
export function plannedUid(): string {
  return randomBytes(21).toString('base64url'); // 28 chars
}

type VerifyTx =
  | { kind: 'proceed' }
  | { kind: 'error'; code: string; attemptsLeft?: number };

export async function handleVerifyPhoneAuthCode(request: CallableRequest<unknown>) {
  const db = getFirestore();
  const cfg = await requireSigninConfig(db, 'verify');
  requireAttestation(request, cfg);
  const pepper = requirePepper();
  const data = (request.data ?? {}) as Record<string, unknown>;
  const sessionKey = sessionKeyFor(pepper, data.sessionToken);
  const challengeId = typeof data.challengeId === 'string' && CHALLENGE_ID_RE.test(data.challengeId) ? data.challengeId : null;
  if (!sessionKey || !challengeId) throw new HttpsError('not-found', 'challenge-not-found');
  const code = typeof data.code === 'string' ? data.code.trim() : '';
  if (!CODE_RE.test(code)) throw new HttpsError('invalid-argument', 'code-invalid');

  const L = cfg.limits;
  const now = Date.now();
  const chRef = db.collection(C.challenges).doc(challengeId);
  const opRef = db.collection(C.ops).doc(challengeId);

  const res = await db.runTransaction<VerifyTx>(async tx => {
    const [chS, opS] = await tx.getAll(chRef, opRef);
    // Anything not created for THIS session looks exactly like "no such challenge".
    if (!chS.exists || chS.get('sessionKey') !== sessionKey || chS.get('purpose') !== 'signin') {
      return { kind: 'error', code: 'challenge-not-found' };
    }
    if (opS.exists) {
      // Already accepted: continue/repeat completion without re-checking the
      // (consumed) code — but only inside the bounded window measured from
      // ACCEPTANCE. Every token mint re-checks eligibility (mintAllowed).
      return withinCompletionWindow(opS.get('acceptedAtMs'), now, L.tokenRetryWindowSec)
        ? { kind: 'proceed' } : { kind: 'error', code: 'challenge-not-found' };
    }
    const ch = chS.data()!;
    const destRef = db.collection(C.limits).doc(`dest_${ch.phoneKey}`);
    const destS = await tx.get(destRef);
    if (ch.status !== 'pending') {
      return { kind: 'error', code: ch.status === 'expired' ? 'code-expired' : ch.status === 'locked' ? 'too-many-attempts' : 'challenge-not-found' };
    }
    if (((ch.expiresAtMs as number) ?? 0) <= now) {
      tx.update(chRef, { status: 'expired', codeVerifier: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
      return { kind: 'error', code: 'code-expired' };
    }
    const attempts = (ch.attempts as number) ?? 0;
    const maxAttempts = (ch.maxAttempts as number) ?? L.maxVerifyAttempts;
    const dest = (destS.data() ?? {}) as DestinationCounter;
    if (attempts >= maxAttempts || destinationVerifyExhausted(dest, now, L.destinationVerifyFailuresPerDay)) {
      return { kind: 'error', code: 'too-many-attempts' };
    }
    const binding = { challengeId, uid: sessionKey, purpose: 'signin' as const, phoneKey: ch.phoneKey as string };
    const review = ch.review === true ? cfg.review : null;
    if (ch.review === true && (!review || review.phoneE164 !== ch.phoneE164)) {
      // Review access was revoked/expired after the code was requested.
      return { kind: 'error', code: 'challenge-not-found' };
    }
    const correct = review ? reviewCodeMatches(review, code) : verifyCode(pepper, binding, code, ch.codeVerifier as string);
    if (!correct) {
      const next = attempts + 1;
      const burned = next >= maxAttempts;
      tx.update(chRef, {
        attempts: next,
        ...(burned ? { status: 'locked', codeVerifier: FieldValue.delete() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(destRef, { ...applyDestinationVerifyFailure(dest, now), updatedAt: FieldValue.serverTimestamp(), expireAt: Timestamp.fromMillis(now + 31 * DAY_MS) });
      return burned ? { kind: 'error', code: 'too-many-attempts' } : { kind: 'error', code: 'code-invalid', attemptsLeft: maxAttempts - next };
    }
    tx.update(chRef, { status: 'used', usedAt: FieldValue.serverTimestamp(), codeVerifier: FieldValue.delete() });
    tx.create(opRef, review ? {
      // Review access signs into the configured demo account ONLY. It never
      // resolves the number, creates or touches another account, and — since
      // no SMS proved possession — records NO phone on the demo account (no
      // phoneVerified, no private phone, so no contact/group linking).
      challengeId, sessionKey, stage: 'review-ready', uid: review.uid, created: false, review: true,
      reviewGen: reviewGeneration(review), phoneKey: ch.phoneKey, acceptedAtMs: now,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    } : {
      challengeId, sessionKey, stage: 'verified',
      phoneKey: ch.phoneKey, phoneE164: ch.phoneE164,
      plannedUid: plannedUid(), acceptedAtMs: now,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    return { kind: 'proceed' };
  });

  if (res.kind === 'error') {
    if (res.code === 'code-invalid') throw new HttpsError('permission-denied', 'code-invalid', { attemptsLeft: res.attemptsLeft });
    if (res.code === 'too-many-attempts') throw new HttpsError('resource-exhausted', 'too-many-attempts');
    if (res.code === 'code-expired') throw new HttpsError('deadline-exceeded', 'code-expired');
    throw new HttpsError('not-found', res.code);
  }
  return completeSignin(challengeId, cfg);
}

/** Resolve the Auth user for a verified op. Only an explicit user-not-found means "no account". */
async function resolveUser(e164: string, planned: string): Promise<{ user: UserRecord; created: boolean }> {
  try {
    const u = await phoneAuthDeps.getUserByPhone(e164);
    return { user: u, created: u.uid === planned };
  } catch (e) {
    if (authErrorCode(e) !== 'auth/user-not-found') throw e;
  }
  try {
    return { user: await phoneAuthDeps.createUser(planned, e164), created: true };
  } catch (e) {
    const c = authErrorCode(e);
    if (c === 'auth/uid-already-exists') {
      // A previous attempt created it before crashing.
      const u = await phoneAuthDeps.getUser(planned);
      if (u.phoneNumber === e164) return { user: u, created: true };
    } else if (c === 'auth/phone-number-already-exists') {
      // Someone else's flow created/linked it concurrently: sign into that account.
      const u = await phoneAuthDeps.getUserByPhone(e164);
      return { user: u, created: u.uid === planned };
    }
    throw e;
  }
}

/** Pure: is `now` inside the completion/retry window that starts at acceptance? */
export function withinCompletionWindow(acceptedAtMs: unknown, now: number, windowSec: number): boolean {
  return typeof acceptedAtMs === 'number' && Number.isFinite(acceptedAtMs)
    && now >= acceptedAtMs - 5_000 && now < acceptedAtMs + windowSec * 1000;
}

/** Identity of one review-access configuration: any rotation (code, salt,
 *  number, demo uid, expiry) or disable produces a different generation. */
export function reviewGeneration(r: ReviewAccess): string {
  return createHash('sha256').update(`review:v1|${r.phoneE164}|${r.uid}|${r.codeSalt}|${r.codeHash}|${r.expiresAtMs}`).digest('hex');
}

/**
 * Pure: a designated store-review demo account carries the custom claim
 * `demoReview: true` and NO other claims (no admin/role/org/relay power).
 * Set up only via scripts/setReviewAccess.ts.
 */
export function isDemoReviewAccount(user: { customClaims?: Record<string, unknown> | null; disabled?: boolean }): boolean {
  const c = user.customClaims ?? {};
  const keys = Object.keys(c);
  return !user.disabled && c.demoReview === true && keys.length === 1;
}

/**
 * The ONE gate in front of every token mint (first completion, resume, or a
 * lost-response replay of an accepted op). Re-checks, at mint time:
 *   • the completion window from acceptance (explicit server deadline)
 *   • review ops: the CURRENT review access is enabled, unexpired, the same
 *     generation, the same demo uid, and that uid is a designated demo account
 *   • Auth: user exists and is not disabled
 *   • profile: not suspended (setUserStatus only writes the profile)
 */
async function assertMintAllowed(op: FirebaseFirestore.DocumentSnapshot, cfg: PhoneAuthConfig): Promise<UserRecord> {
  if (!withinCompletionWindow(op.get('acceptedAtMs'), Date.now(), cfg.limits.tokenRetryWindowSec)) {
    throw new HttpsError('not-found', 'challenge-not-found');
  }
  const uid = op.get('uid') as string;
  if (op.get('review') === true) {
    const r = cfg.review;
    if (!r || reviewGeneration(r) !== op.get('reviewGen') || r.uid !== uid) {
      throw new HttpsError('not-found', 'challenge-not-found');
    }
  }
  let user: UserRecord;
  try { user = await phoneAuthDeps.getUser(uid); } catch { throw new HttpsError('unavailable', 'signin-interrupted'); }
  if (user.disabled) throw new HttpsError('permission-denied', 'account-disabled');
  if (op.get('review') === true && !isDemoReviewAccount(user)) throw new HttpsError('permission-denied', 'account-disabled');
  const profile = await getFirestore().collection('users').doc(uid).get();
  if (profile.exists && !profileIsActive(true, profile.get('status'))) throw new HttpsError('permission-denied', 'account-disabled');
  return user;
}

export async function completeSignin(challengeId: string, cfg: PhoneAuthConfig): Promise<{ customToken: string; uid: string; isNewUser: boolean }> {
  const db = getFirestore();
  const opRef = db.collection(C.ops).doc(challengeId);
  let op = await opRef.get();
  if (!op.exists) throw new HttpsError('not-found', 'challenge-not-found');
  // Bounded completion: nothing (not even recovery work) happens after the
  // window closes, regardless of TTL cleanup.
  if (!withinCompletionWindow(op.get('acceptedAtMs'), Date.now(), cfg.limits.tokenRetryWindowSec)) {
    throw new HttpsError('not-found', 'challenge-not-found');
  }

  try {
    if (op.get('stage') === 'review-ready') {
      await assertMintAllowed(op, cfg); // demo eligibility before marking done
      await db.runTransaction(async tx => {
        const s = await tx.get(opRef);
        if (s.get('stage') !== 'review-ready') return;
        tx.update(opRef, { stage: 'done', completedAt: FieldValue.serverTimestamp(), completedAtMs: Date.now(), updatedAt: FieldValue.serverTimestamp() });
      });
      op = await opRef.get();
    }

    if (op.get('stage') === 'verified') {
      const { user, created } = await resolveUser(op.get('phoneE164') as string, op.get('plannedUid') as string);
      if (user.disabled) throw new HttpsError('permission-denied', 'account-disabled');
      await db.runTransaction(async tx => {
        const s = await tx.get(opRef);
        if (s.get('stage') !== 'verified') return; // another worker advanced it
        tx.update(opRef, { stage: 'user-ready', uid: user.uid, created, updatedAt: FieldValue.serverTimestamp() });
      });
      op = await opRef.get();
    }

    if (op.get('stage') === 'user-ready') {
      await phoneAuthDeps.beforeBootstrap(challengeId);
      const uid = op.get('uid') as string;
      const userRef = db.collection('users').doc(uid);
      const walletRef = db.collection('wallets').doc(uid);
      await db.runTransaction(async tx => {
        const [s, userS, walletS] = await tx.getAll(opRef, userRef, walletRef);
        if (s.get('stage') !== 'user-ready' || s.get('uid') !== uid) return; // monotonic
        // A suspended profile can't sign in; a missing profile (new account, or
        // a legacy account never bootstrapped) is treated as active.
        if (userS.exists && !profileIsActive(true, userS.get('status'))) {
          throw new HttpsError('permission-denied', 'account-disabled');
        }
        const e164 = s.get('phoneE164') as string;
        if (s.get('created') === true) {
          if (!userS.exists || !userS.get('createdAt')) {
            tx.set(userRef, {
              displayName: null, username: null, usernameLower: null, about: null,
              profileCompleted: false, status: 'active', phoneVerified: true,
              createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          }
          if (!walletS.exists && s.get('welcomeGranted') !== true) {
            tx.create(walletRef, { balance: 50, reserved: 0, createdAt: FieldValue.serverTimestamp() });
          }
        } else {
          tx.set(userRef, { phoneVerified: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
        tx.set(userPrivateProfileRef(db, uid), { phoneNumber: e164, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        tx.update(opRef, {
          stage: 'done', welcomeGranted: s.get('created') === true,
          completedAt: FieldValue.serverTimestamp(), completedAtMs: Date.now(),
          phoneE164: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(),
        });
      });
      op = await opRef.get();
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.warn('[phoneAuth] completion interrupted', { op: auditTag(challengeId), code: authErrorCode(e) || (e as Error)?.message });
    throw new HttpsError('unavailable', 'signin-interrupted');
  }

  if (op.get('stage') !== 'done') throw new HttpsError('unavailable', 'signin-interrupted');
  const uid = op.get('uid') as string;
  let customToken: string;
  await assertMintAllowed(op, cfg);
  try {
    customToken = await phoneAuthDeps.mintToken(uid);
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('unavailable', 'signin-interrupted');
  }
  await writeAuditLog({
    action: 'phoneAuth.signedIn', actor: { uid },
    target: { type: 'phoneHash', id: auditTag(op.get('phoneKey') as string) }, result: 'success',
    metadata: { created: op.get('created') === true },
  });
  return { customToken, uid, isNewUser: op.get('created') === true };
}

export const verifyPhoneAuthCode = onCall(
  { region: REGION, secrets: [PHONE_HASH_PEPPER], ...appCheckOptions({ replayProtected: true }) },
  handleVerifyPhoneAuthCode,
);
