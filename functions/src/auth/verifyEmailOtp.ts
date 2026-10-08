// Callable: verifyEmailOtp — check the emailed code and return a Firebase custom
// token. UNAUTH by design. On success: consume the one-time code, find-or-create
// the email user (marking the email verified), and mint a custom token the app
// uses with signInWithCustomToken. Mirrors verifyPhoneOtp.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { writeAuditLog } from '../lib/auditLog';
import { verifyOtpHash, isOtpExpired, OTP_MAX_ATTEMPTS, OTP_CODE_LENGTH } from './otpLogic';
import { normalizeEmail, emailKey } from './emailOtpLogic';
import { appCheckOptions } from '../lib/appCheck';
import { writeUserPrivateProfile } from '../lib/userPrivate';

const REGION = 'us-central1';

export const verifyEmailOtp = onCall({ region: REGION, ...appCheckOptions() }, async (request) => {
  const data = (request.data ?? {}) as { email?: unknown; code?: unknown };
  const email = normalizeEmail(data.email);
  const code = typeof data.code === 'string' ? data.code.trim() : '';
  if (!email) throw new HttpsError('invalid-argument', 'email-invalid');
  if (!/^\d+$/.test(code) || code.length !== OTP_CODE_LENGTH) {
    throw new HttpsError('invalid-argument', 'code-invalid');
  }

  const db = getFirestore();
  const key = emailKey(email);
  const ref = db.collection('emailOtpChallenges').doc(key);
  const now = Date.now();

  // Atomically validate + consume an attempt to prevent brute-force races. The
  // transaction RETURNS its verdict instead of throwing, so expiry/lockout
  // cleanup and wrong-code counting actually commit. Send budgets live in
  // emailOtpLimits/{key} and are never touched here.
  const verdict = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 'otp-not-requested';
    const c = snap.data()!;
    if (c.status === 'sending' || c.status === 'send-failed') return 'otp-not-requested';
    if (isOtpExpired(c.expiresAt?.toMillis?.() ?? 0, now)) { tx.delete(ref); return 'otp-expired'; }
    const attempts = (c.attempts as number) ?? 0;
    if (attempts >= OTP_MAX_ATTEMPTS) { tx.delete(ref); return 'otp-too-many-attempts'; }
    if (!verifyOtpHash(code, c.salt as string, c.codeHash as string)) {
      tx.update(ref, { attempts: attempts + 1, updatedAt: FieldValue.serverTimestamp() });
      return 'otp-incorrect';
    }
    tx.delete(ref); // one-time use
    return 'ok';
  });

  if (verdict === 'otp-not-requested') throw new HttpsError('failed-precondition', verdict);
  if (verdict === 'otp-expired') throw new HttpsError('deadline-exceeded', verdict);
  if (verdict === 'otp-too-many-attempts') throw new HttpsError('resource-exhausted', verdict);
  if (verdict !== 'ok') throw new HttpsError('permission-denied', 'otp-incorrect');

  // Find-or-create the email user, mark verified, mint a custom token.
  const adminAuth = getAuth();
  let uid: string;
  let created = false;
  try {
    uid = (await adminAuth.getUserByEmail(email)).uid;
  } catch (e) {
    // Only an explicit "no such user" means create; any other Auth error is a
    // failure, never a reason to mint a second account.
    if ((e as { code?: string })?.code !== 'auth/user-not-found') throw new HttpsError('unavailable', 'signin-interrupted');
    uid = (await adminAuth.createUser({ email, emailVerified: true })).uid;
    created = true;
  }

  const userRef = db.collection('users').doc(uid);
  if (created) {
    // Admin-SDK createUser() does NOT trigger the beforeUserCreated blocking
    // hook, so bootstrap the profile + welcome wallet here (mirrors verifyPhoneOtp).
    await userRef.set({
      displayName:      null,
      username:         null,
      usernameLower:    null,
      about:            null,
      profileCompleted: false,
      status:           'active',
      emailVerified:    true,
      createdAt:        FieldValue.serverTimestamp(),
      updatedAt:        FieldValue.serverTimestamp(),
    }, { merge: true });
    await db.collection('wallets').doc(uid).set({
      balance:   50,            // 50-pt welcome credit (matches verifyPhoneOtp)
      reserved:  0,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } else {
    await adminAuth.updateUser(uid, { emailVerified: true });
    await userRef.set(
      { emailVerified: true, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
  // F1 Phase C: sensitive PII (email) is written ONLY to the owner/admin-only
  // private subdoc users/{uid}/userPrivate/profile — never to the public users doc.
  await writeUserPrivateProfile(db, uid, { email, ...(created ? { phoneNumber: null } : {}) });

  const customToken = await adminAuth.createCustomToken(uid);

  await writeAuditLog({
    action: 'auth.email-otp.verified', actor: { uid },
    target: { type: 'email', id: key }, result: 'success',
  });

  return { customToken, uid };
});
