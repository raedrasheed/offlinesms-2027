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

const REGION = 'us-central1';

export const verifyEmailOtp = onCall({ region: REGION }, async (request) => {
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

  // Atomically validate + consume an attempt to prevent brute-force races.
  const ok = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('failed-precondition', 'otp-not-requested');
    const c = snap.data()!;
    if (isOtpExpired(c.expiresAt?.toMillis?.() ?? 0, now)) {
      tx.delete(ref);
      throw new HttpsError('deadline-exceeded', 'otp-expired');
    }
    const attempts = (c.attempts as number) ?? 0;
    if (attempts >= OTP_MAX_ATTEMPTS) {
      tx.delete(ref);
      throw new HttpsError('resource-exhausted', 'otp-too-many-attempts');
    }
    if (!verifyOtpHash(code, c.salt as string, c.codeHash as string)) {
      tx.update(ref, { attempts: attempts + 1, updatedAt: FieldValue.serverTimestamp() });
      return false;
    }
    tx.delete(ref); // one-time use
    return true;
  });

  if (!ok) throw new HttpsError('permission-denied', 'otp-incorrect');

  // Find-or-create the email user, mark verified, mint a custom token.
  const adminAuth = getAuth();
  let uid: string;
  let created = false;
  try {
    uid = (await adminAuth.getUserByEmail(email)).uid;
  } catch {
    uid = (await adminAuth.createUser({ email, emailVerified: true })).uid;
    created = true;
  }

  const userRef = db.collection('users').doc(uid);
  if (created) {
    // Admin-SDK createUser() does NOT trigger the beforeUserCreated blocking
    // hook, so bootstrap the profile + welcome wallet here (mirrors verifyPhoneOtp).
    await userRef.set({
      displayName:      null,
      phoneNumber:      null,
      email,
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
      { email, emailVerified: true, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
  const customToken = await adminAuth.createCustomToken(uid);

  await writeAuditLog({
    action: 'auth.email-otp.verified', actor: { uid },
    target: { type: 'email', id: key }, result: 'success',
  });

  return { customToken, uid };
});
