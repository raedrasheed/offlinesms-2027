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
  const now = Date.now();

  const prev = await ref.get();
  const p = prev.exists ? prev.data()! : {};
  if (!canResend(p.lastSentAt?.toMillis?.() ?? null, now)) {
    throw new HttpsError('resource-exhausted', 'otp-cooldown');
  }
  const win = nextSendWindow(p.windowStartAt?.toMillis?.() ?? null, p.sendCount ?? 0, now);
  if (!win.allowed) throw new HttpsError('resource-exhausted', 'otp-rate-limited');

  const code = generateOtp();
  const salt = newSalt();

  // Send first; only persist the challenge (and advance the rate-limit window)
  // once delivery succeeds, so a provider outage doesn't lock the user out.
  const { subject, html, text } = renderOtpEmail({ code, ttlMinutes: TTL_MINUTES, supportEmail });
  try {
    await sendEmail({ to: email, subject, html, text });
  } catch {
    // Never include the provider error detail (the request carried the code).
    throw new HttpsError('unavailable', 'email-send-failed');
  }

  // Overwriting the doc invalidates any previously active code for this email.
  await ref.set({
    email,
    codeHash: hashOtp(code, salt),
    salt,
    expiresAt: Timestamp.fromMillis(now + EMAIL_OTP_TTL_MS),
    attempts: 0,
    lastSentAt: Timestamp.fromMillis(now),
    windowStartAt: Timestamp.fromMillis(win.windowStartMs),
    sendCount: win.count,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAuditLog({
    action: 'auth.email-otp.requested', actor: { uid: 'anonymous' },
    target: { type: 'email', id: key }, result: 'success',
    // email/code are never logged (forbidden keys are redacted by the helper).
  });

  return { ok: true };
});
