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

async function otpBusinessId(db: FirebaseFirestore.Firestore): Promise<string | null> {
  const snap = await db.collection('smsConfig').doc('otp').get();
  const id = snap.exists ? (snap.data()?.businessId as string | undefined) : undefined;
  return id ?? null;
}

export const requestPhoneOtp = onCall({ region: REGION, ...appCheckOptions() }, async (request) => {
  // TODO(security): enforce App Check once the mobile app attests.
  const phone = normalizeE164((request.data ?? {}).phoneE164);
  if (!phone) throw new HttpsError('invalid-argument', 'phone-invalid');

  // App-review test account: no SMS, fixed code (handled in verifyPhoneOtp).
  // Returns success without touching the relay or rate-limit state.
  if (isTestPhone(phone)) return { ok: true };

  const db = getFirestore();
  const businessId = await otpBusinessId(db);
  if (!businessId) throw new HttpsError('failed-precondition', 'otp-not-configured');

  // Country-based relay routing: the OTP is sent via relay, so it must respect
  // country coverage like every other send. If no live relay of the OTP business
  // covers this number's country, don't send (sign-in isn't possible there).
  const { countryCode } = normalizePhoneAndCountry(phone);
  if (!countryCode) throw new HttpsError('failed-precondition', 'no-relay-for-country');

  // Restricted mobile prefixes per country (PS/IL must start with 59 or 56).
  const nationalNumber = parsePhoneNumberFromString(phone)?.nationalNumber ?? '';
  if (!isSupportedSignInNumber(countryCode, nationalNumber)) {
    throw new HttpsError('invalid-argument', 'number-not-supported');
  }

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
    messageBody: `Your OfflineSMS verification code is ${code}. It expires in 5 minutes.`,
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
