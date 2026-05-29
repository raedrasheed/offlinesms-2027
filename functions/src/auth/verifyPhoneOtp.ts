// Callable: verifyPhoneOtp — check the code and return a Firebase custom token.
// UNAUTH by design. On success: find-or-create the phone user, mark verified,
// and mint a custom token the app uses with signInWithCustomToken.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { writeAuditLog } from '../lib/auditLog';
import {
  normalizeE164, phoneKey, verifyOtpHash, isOtpExpired, OTP_MAX_ATTEMPTS, OTP_CODE_LENGTH,
} from './otpLogic';

const REGION = 'us-central1';

export const verifyPhoneOtp = onCall({ region: REGION }, async (request) => {
  const data = (request.data ?? {}) as { phoneE164?: unknown; code?: unknown };
  const phone = normalizeE164(data.phoneE164);
  const code = typeof data.code === 'string' ? data.code.trim() : '';
  if (!phone) throw new HttpsError('invalid-argument', 'phone-invalid');
  if (!/^\d+$/.test(code) || code.length !== OTP_CODE_LENGTH) {
    throw new HttpsError('invalid-argument', 'code-invalid');
  }

  const db = getFirestore();
  const key = phoneKey(phone);
  const ref = db.collection('otpChallenges').doc(key);
  const now = Date.now();

  // Atomically validate + consume an attempt to prevent brute-force races.
  const ok = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('failed-precondition', 'otp-not-requested');
    const c = snap.data()!;
    if (isOtpExpired(c.expiresAt?.toMillis?.() ?? 0, now)) { tx.delete(ref); throw new HttpsError('deadline-exceeded', 'otp-expired'); }
    const attempts = (c.attempts as number) ?? 0;
    if (attempts >= OTP_MAX_ATTEMPTS) { tx.delete(ref); throw new HttpsError('resource-exhausted', 'otp-too-many-attempts'); }

    if (!verifyOtpHash(code, c.salt as string, c.codeHash as string)) {
      tx.update(ref, { attempts: attempts + 1, updatedAt: FieldValue.serverTimestamp() });
      return false;
    }
    tx.delete(ref); // one-time use
    return true;
  });

  if (!ok) throw new HttpsError('permission-denied', 'otp-incorrect');

  // Find-or-create the phone user, mark verified, mint a custom token.
  const adminAuth = getAuth();
  let uid: string;
  try {
    uid = (await adminAuth.getUserByPhoneNumber(phone)).uid;
  } catch {
    uid = (await adminAuth.createUser({ phoneNumber: phone })).uid; // triggers onUserCreate bootstrap
  }
  await db.collection('users').doc(uid).set(
    { phoneNumber: phone, phoneVerified: true, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  const customToken = await adminAuth.createCustomToken(uid);

  await writeAuditLog({
    action: 'auth.otp.verified', actor: { uid },
    target: { type: 'phone', id: key }, result: 'success',
  });

  return { customToken, uid };
});
