// Callable: requestEmailOtp — email a sign-in OTP (passwordless). UNAUTH by
// design (the user may not have an account yet). Rate-limited per email; the
// code is stored hashed in emailOtpChallenges/{emailKey} (backend-only); the
// email is delivered via the configured provider (Resend by default).
//
// Gated by the admin "Email sign-in" flag (systemSettings/general.emailSignInEnabled).

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';
import { generateOtp, newSalt, hashOtp, canResend, nextSendWindow } from './otpLogic';
import { normalizeEmail, emailKey, EMAIL_OTP_TTL_MS } from './emailOtpLogic';
import { sendEmail } from '../lib/email';
import { renderOtpEmail } from '../lib/email/template';
import { appCheckOptions } from '../lib/appCheck';

const REGION = 'us-central1';
const TTL_MINUTES = Math.round(EMAIL_OTP_TTL_MS / 60000);

async function readGeneralSettings(
  db: FirebaseFirestore.Firestore,
): Promise<{ enabled: boolean; supportEmail: string | null }> {
  const snap = await db.collection('systemSettings').doc('general').get();
  const d = snap.exists ? snap.data()! : {};
  return {
    enabled: d.emailSignInEnabled === true,
    supportEmail: (d.supportEmail as string | undefined)?.trim() || null,
  };
}

export const requestEmailOtp = onCall({ region: REGION, ...appCheckOptions() }, async (request) => {
  const email = normalizeEmail((request.data ?? {}).email);
  if (!email) throw new HttpsError('invalid-argument', 'email-invalid');

  const db = getFirestore();
  const { enabled, supportEmail } = await readGeneralSettings(db);
  if (!enabled) throw new HttpsError('failed-precondition', 'email-signin-disabled');

  const key = emailKey(email);
  const ref = db.collection('emailOtpChallenges').doc(key);
  const limRef = db.collection('emailOtpLimits').doc(key);
  const now = Date.now();
  const code = generateOtp();
  const salt = newSalt();

  // Reserve the send atomically BEFORE delivering: cooldown + hourly window
  // live in emailOtpLimits/{key}, separate from the short-lived challenge, so
  // verification, expiry or cleanup never reset them. Concurrent requests
  // serialize on the limits doc, so they can't share one allowance.
  const verdict = await db.runTransaction(async tx => {
    const lim = await tx.get(limRef);
    const p = lim.exists ? lim.data()! : {};
    if (!canResend(p.lastSentAt?.toMillis?.() ?? null, now)) return 'otp-cooldown';
    const win = nextSendWindow(p.windowStartAt?.toMillis?.() ?? null, p.sendCount ?? 0, now);
    if (!win.allowed) return 'otp-rate-limited';
    tx.set(limRef, {
      lastSentAt: Timestamp.fromMillis(now),
      windowStartAt: Timestamp.fromMillis(win.windowStartMs),
      sendCount: win.count,
      updatedAt: FieldValue.serverTimestamp(),
    });
    // Overwriting the challenge invalidates any previously active code.
    tx.set(ref, {
      email,
      codeHash: hashOtp(code, salt),
      salt,
      expiresAt: Timestamp.fromMillis(now + EMAIL_OTP_TTL_MS),
      attempts: 0,
      status: 'sending',
      updatedAt: FieldValue.serverTimestamp(),
    });
    return 'ok';
  });
  if (verdict !== 'ok') throw new HttpsError('resource-exhausted', verdict);

  // Deliver after the reservation committed (never inside a retryable tx).
  const { subject, html, text } = renderOtpEmail({ code, ttlMinutes: TTL_MINUTES, supportEmail });
  try {
    await sendEmail({ to: email, subject, html, text });
  } catch {
    // A failed provider call may or may not have delivered; the reservation is
    // kept (conservative) and the code is voided. Never include provider detail.
    await ref.update({ status: 'send-failed', updatedAt: FieldValue.serverTimestamp() }).catch(() => {});
    throw new HttpsError('unavailable', 'email-send-failed');
  }
  await ref.update({ status: 'pending', updatedAt: FieldValue.serverTimestamp() }).catch(() => {});

  await writeAuditLog({
    action: 'auth.email-otp.requested', actor: { uid: 'anonymous' },
    target: { type: 'email', id: key }, result: 'success',
    // email/code are never logged (forbidden keys are redacted by the helper).
  });

  return { ok: true };
});
