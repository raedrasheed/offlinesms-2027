// Callable: requestEmailChangeCode — email a verification code to a NEW address
// so a signed-in account can add an email (phone-registered accounts) or
// replace its current one. This is NOT sign-in and never creates an account.
//
// Order of checks:
//   1. authenticated; email delivery switched on (systemSettings/general
//      .emailSignInEnabled — the same switch as email sign-in, since an address
//      that can't sign in is useless as a sign-in method)
//   2. eligible caller (see phoneLink/gates.requireEligibleCaller): a person,
//      Auth-enabled, active profile, holding a verified sign-in method, and
//      signed in within reauthMaxAgeSec
//   3. no change of this account is mid-way (that one is resumed instead)
//   4. ONE transaction: account limits + per-address send limits (shared with
//      email sign-in) → counters + the account's single live challenge
//   5. deliver the email; record the provider outcome for THIS generation only
//
// Whether the address belongs to another account is NOT revealed here: that is
// only decided after the code proves the caller controls the address.
//
// Input:  { email }
// Output: { ok: true, challengeId, expiresAtMs, resendAfterSec, maskedEmail }

import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { appCheckOptions } from '../lib/appCheck';
import { writeAuditLog } from '../lib/auditLog';
import { sendEmail } from '../lib/email';
import { renderOtpEmail } from '../lib/email/template';
import { generateOtp, newSalt, canResend, nextSendWindow, OTP_RESEND_COOLDOWN_MS } from '../auth/otpLogic';
import { normalizeEmail, emailKey } from '../auth/emailOtpLogic';
import { newChallengeId } from '../phoneLink/crypto';
import { requireEligibleCaller } from '../phoneLink/gates';
import { DAY_MS } from '../phoneLink/limits';
import {
  EMAIL_CHANGE_COLLECTIONS as C, EMAIL_CHANGE_LIMITS as L, EMAIL_CHANGE_PURPOSE,
  checkEmailChangeAccount, applyEmailChangeAccount, emailChangeVerifier, maskEmail,
  type EmailChangeAccountCounter,
} from './logic';

const REGION = 'us-central1';

export async function readEmailSettings(db: FirebaseFirestore.Firestore): Promise<{ enabled: boolean; supportEmail: string | null }> {
  const snap = await db.collection('systemSettings').doc('general').get();
  const d = snap.exists ? snap.data()! : {};
  return { enabled: d.emailSignInEnabled === true, supportEmail: (d.supportEmail as string | undefined)?.trim() || null };
}

/** Record the provider outcome for ONE send generation (a late result never touches a newer challenge). */
async function settle(db: FirebaseFirestore.Firestore, ref: FirebaseFirestore.DocumentReference, generation: string, status: 'pending' | 'send-failed') {
  await db.runTransaction(async tx => {
    const s = await tx.get(ref);
    if (!s.exists || s.get('generation') !== generation || s.get('status') !== 'sending') return;
    tx.update(ref, {
      status, updatedAt: FieldValue.serverTimestamp(),
      ...(status === 'send-failed' ? { codeHash: FieldValue.delete() } : {}),
    });
  });
}

type TxOut =
  | { kind: 'ok' }
  | { kind: 'limit'; code: string; retryAfterSec: number }
  | { kind: 'reject'; code: 'change-pending-recovery' };

export async function handleRequestEmailChangeCode(request: CallableRequest<unknown>) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'auth-required');
  const data = (request.data ?? {}) as Record<string, unknown>;
  if (data.purpose !== undefined && data.purpose !== EMAIL_CHANGE_PURPOSE) throw new HttpsError('invalid-argument', 'purpose-invalid');
  const email = normalizeEmail(data.email);
  if (!email) throw new HttpsError('invalid-argument', 'email-invalid');

  const db = getFirestore();
  const settings = await readEmailSettings(db);
  if (!settings.enabled) throw new HttpsError('failed-precondition', 'email-change-disabled');

  const caller = await requireEligibleCaller(request, db, L.reauthMaxAgeSec);
  const uid = caller.uid;
  if (caller.user.email && caller.user.email.toLowerCase() === email && caller.user.emailVerified === true) {
    throw new HttpsError('failed-precondition', 'already-linked');
  }

  const key = emailKey(email);
  const now = Date.now();
  const challengeId = newChallengeId();
  const code = generateOtp();
  const salt = newSalt();
  const generation = newSalt();
  const expiresAtMs = now + L.codeTtlSec * 1000;

  const chRef = db.collection(C.challenges).doc(uid);
  const opRef = db.collection(C.ops).doc(uid);
  const acctRef = db.collection(C.limits).doc(`acct_${uid}`);
  const destRef = db.collection('emailOtpLimits').doc(key);

  const out = await db.runTransaction<TxOut>(async tx => {
    const [opS, acctS, destS] = await tx.getAll(opRef, acctRef, destRef);
    const stage = opS.exists ? (opS.get('stage') as string) : null;
    if (stage && stage !== 'done' && stage !== 'failed') return { kind: 'reject', code: 'change-pending-recovery' };

    const acct = (acctS.data() ?? {}) as EmailChangeAccountCounter;
    const rej = checkEmailChangeAccount(acct, key, now);
    if (rej) return { kind: 'limit', code: rej.code, retryAfterSec: rej.retryAfterSec };

    const p = destS.exists ? destS.data()! : {};
    const lastSent = (p.lastSentAt as Timestamp | undefined)?.toMillis?.() ?? null;
    if (!canResend(lastSent, now)) {
      return { kind: 'limit', code: 'cooldown', retryAfterSec: Math.ceil(((lastSent ?? now) + OTP_RESEND_COOLDOWN_MS - now) / 1000) };
    }
    const win = nextSendWindow((p.windowStartAt as Timestamp | undefined)?.toMillis?.() ?? null, p.sendCount as number | undefined, now);
    if (!win.allowed) return { kind: 'limit', code: 'rate-limited', retryAfterSec: 3600 };

    tx.set(acctRef, { ...applyEmailChangeAccount(acct, key, now), updatedAt: FieldValue.serverTimestamp(), expireAt: Timestamp.fromMillis(now + 2 * DAY_MS) });
    tx.set(destRef, {
      lastSentAt: Timestamp.fromMillis(now), windowStartAt: Timestamp.fromMillis(win.windowStartMs),
      sendCount: win.count, updatedAt: FieldValue.serverTimestamp(),
    });
    // One live challenge per account: this overwrites (invalidates) any earlier code.
    tx.set(chRef, {
      challengeId, uid, purpose: EMAIL_CHANGE_PURPOSE, email, emailKey: key,
      codeHash: emailChangeVerifier({ challengeId, uid, emailKey: key }, code, salt), salt,
      attempts: 0, maxAttempts: L.maxVerifyAttempts, status: 'sending', generation,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(expiresAtMs), expireAt: Timestamp.fromMillis(expiresAtMs + DAY_MS),
    });
    return { kind: 'ok' };
  });

  if (out.kind === 'reject') throw new HttpsError('failed-precondition', out.code);
  if (out.kind === 'limit') throw new HttpsError('resource-exhausted', out.code, { retryAfterSec: out.retryAfterSec });

  const { subject, html, text } = renderOtpEmail({
    code, ttlMinutes: Math.round(L.codeTtlSec / 60), supportEmail: settings.supportEmail, purpose: 'add-email',
  });
  try {
    await sendEmail({ to: email, subject, html, text });
  } catch {
    await settle(db, chRef, generation, 'send-failed').catch(() => {});
    throw new HttpsError('unavailable', 'email-send-failed');
  }
  await settle(db, chRef, generation, 'pending').catch(() => {});

  await writeAuditLog({
    action: 'emailChange.code.requested', actor: { uid },
    target: { type: 'email', id: key }, result: 'success',
    metadata: { hadEmail: !!caller.user.email },
  });
  return {
    ok: true, challengeId, expiresAtMs,
    resendAfterSec: Math.max(L.accountCooldownSec, Math.round(OTP_RESEND_COOLDOWN_MS / 1000)),
    maskedEmail: maskEmail(email),
  };
}

export const requestEmailChangeCode = onCall({ region: REGION, ...appCheckOptions() }, handleRequestEmailChangeCode);
