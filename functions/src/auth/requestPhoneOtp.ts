// Callable: requestPhoneOtp — send a sign-in OTP via the relay (no Firebase
// phone auth / reCAPTCHA). UNAUTH by design (the user has no account yet).
// Rate-limited per phone; the code is stored hashed; the SMS is sent by the
// designated OTP organization's relay device (smsConfig/otp.businessId).

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { writeAuditLog } from '../lib/auditLog';
import {
  normalizeE164, phoneKey, generateOtp, newSalt, hashOtp,
  canResend, nextSendWindow, OTP_TTL_MS, isTestPhone, isSupportedSignInNumber,
} from './otpLogic';
import { normalizePhoneAndCountry } from '../lib/phoneCountry';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { loadActiveRelayDevices } from '../sms/countryRouting';
import { hasRelayCoverageForCountry } from '../sms/relayLogic';
import { appCheckOptions } from '../lib/appCheck';

const REGION = 'us-central1';

async function otpConfig(
  db: FirebaseFirestore.Firestore,
): Promise<{ businessId: string | null; androidAppHash: string | null }> {
  const snap = await db.collection('smsConfig').doc('otp').get();
  const d = snap.exists ? (snap.data() ?? {}) : {};
  const businessId = (d.businessId as string | undefined) ?? null;
  // Optional 11-char app-signature hash for the Android SMS Retriever API. When
  // set, it's appended to the OTP SMS so the app can auto-read the code (zero
  // tap). Left unset → the message is sent unchanged. Keep in sync with the hash
  // produced by the installed app build (react-native-otp-verify getHash()).
  const androidAppHash = (d.androidAppHash as string | undefined)?.trim() || null;
  return { businessId, androidAppHash };
}

/**
 * Build the OTP SMS body. With an Android app hash configured we emit the SMS
 * Retriever format — leading `<#>` marker and the hash on the final line — so
 * the app auto-reads the code; otherwise a plain human-readable message.
 */
function buildOtpMessage(code: string, androidAppHash: string | null): string {
  const base = `Your OfflineSMS verification code is ${code}. It expires in 5 minutes.`;
  return androidAppHash ? `<#> ${base}\n${androidAppHash}` : base;
}

export const requestPhoneOtp = onCall({ region: REGION, ...appCheckOptions() }, async (request) => {
  // TODO(security): enforce App Check once the mobile app attests.
  // A number with no usable country code can't be normalized to E.164 — treat
  // it the same as any other unsupported number ("not supported"), not a vague
  // "invalid", so the user gets one clear reason.
  const phone = normalizeE164((request.data ?? {}).phoneE164);
  if (!phone) throw new HttpsError('invalid-argument', 'number-not-supported');

  // App-review test account: no SMS, fixed code (handled in verifyPhoneOtp).
  // Returns success without touching the relay or rate-limit state.
  if (isTestPhone(phone)) return { ok: true };

  // Supported-number gate (up-front, before any work). Only mobile numbers with
  // a detectable country code whose national number starts with 59 or 56 may
  // sign in; everything else — wrong prefix, no country code, unparseable — is
  // rejected as "not supported".
  const { countryCode } = normalizePhoneAndCountry(phone);
  const nationalNumber = parsePhoneNumberFromString(phone)?.nationalNumber ?? '';
  if (!isSupportedSignInNumber(countryCode, nationalNumber)) {
    throw new HttpsError('invalid-argument', 'number-not-supported');
  }

  const db = getFirestore();
  const { businessId, androidAppHash } = await otpConfig(db);
  if (!businessId) throw new HttpsError('failed-precondition', 'otp-not-configured');

  // Country-based relay routing: the OTP is sent via relay, so it must respect
  // country coverage like every other send. If no live relay of the OTP business
  // covers this number's country, don't send (sign-in isn't possible there).
  // `countryCode` is guaranteed non-null here (the gate above rejects nulls).
  if (!countryCode) throw new HttpsError('failed-precondition', 'no-relay-for-country');

  const otpRelays = await loadActiveRelayDevices(businessId);
  if (!hasRelayCoverageForCountry(otpRelays, countryCode, Date.now())) {
    throw new HttpsError('failed-precondition', 'no-relay-for-country');
  }

  const key = phoneKey(phone);
  const ref = db.collection('otpChallenges').doc(key);
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
  await ref.set({
    phoneE164: phone,
    codeHash: hashOtp(code, salt),
    salt,
    expiresAt: Timestamp.fromMillis(now + OTP_TTL_MS),
    attempts: 0,
    lastSentAt: Timestamp.fromMillis(now),
    windowStartAt: Timestamp.fromMillis(win.windowStartMs),
    sendCount: win.count,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Send via the OTP org's relay (no billing batch, no requeue).
  const jobId = `otp_${key}_${now}`;
  await db.collection('relayJobs').doc(jobId).create({
    jobId, businessId, kind: 'otp',
    batchId: null, recipientUid: null,
    phoneE164: phone, recipientCountryCode: countryCode,
    messageBody: buildOtpMessage(code, androidAppHash),
    assignedDeviceId: null, assignedSimSubscriptionId: null,
    status: 'queued', attempts: 0, maxAttempts: 1,   // never resend an OTP
    leaseOwnerDeviceId: null, leaseExpiresAt: null, nextAttemptAt: null,
    traceId: jobId,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });

  // Best-effort low-latency wake of the OTP org's online devices.
  try {
    const devs = await db.collection('relayDevices')
      .where('businessId', '==', businessId).where('status', '==', 'active').limit(10).get();
    await Promise.all(devs.docs.map(d => {
      const token = d.get('fcmToken') as string | null;
      return token ? getMessaging().send({ token, data: { type: 'relay_wake', businessId }, android: { priority: 'high' } }) : null;
    }).filter(Boolean) as Promise<unknown>[]);
  } catch { /* device also polls */ }

  await writeAuditLog({
    action: 'auth.otp.requested', actor: { uid: 'anonymous' },
    target: { type: 'phone', id: key }, result: 'success',
    metadata: { businessId },   // phone/code are never logged (redacted anyway)
  });

  return { ok: true };
});
