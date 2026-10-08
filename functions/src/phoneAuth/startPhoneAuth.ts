// Callable: startPhoneAuth — open a pre-authentication session for public phone
// sign-in / sign-up (no account required). UNAUTHENTICATED by design.
//
// Returns an opaque 256-bit session token (stored server-side only as an HMAC)
// and a proof-of-work challenge that the next code request must solve for the
// specific number. Session creation itself is rate-limited per request source,
// so minting fresh sessions to escape the per-session caps hits a separate
// ceiling. Sends nothing.
//
// Input:  { installationId?: string }   — random per-install id; UNTRUSTED signal
// Output: { sessionToken, expiresAtMs, pow: { nonce, bits, expiresAtMs } }

import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { appCheckOptions } from '../lib/appCheck';
import { REGION, PHONE_HASH_PEPPER, requirePepper } from '../phoneLink/shared';
import { newOpaqueToken, auditTag } from '../phoneLink/crypto';
import { checkWindows, applyWindows, windowCount, HOUR_MS, type WindowCounter } from '../phoneLink/limits';
import { newPowNonce, adaptiveBits } from './pow';
import {
  PHONE_AUTH_COLLECTIONS as C, SIGNIN_GLOBAL_COUNTER_ID, requireSigninConfig, requireAttestation,
  sourceKeyFor, sessionKeyFor, installKeyFor,
} from './shared';

export async function handleStartPhoneAuth(request: CallableRequest<unknown>) {
  const db = getFirestore();
  const cfg = await requireSigninConfig(db, 'send');
  requireAttestation(request, cfg);
  const pepper = requirePepper();
  const L = cfg.limits;
  const data = (request.data ?? {}) as Record<string, unknown>;

  const srcKey = sourceKeyFor(request, pepper, cfg.sourceHopsFromRight);
  const installKey = installKeyFor(pepper, data.installationId);
  const sessionToken = newOpaqueToken();
  const sessionKey = sessionKeyFor(pepper, sessionToken)!;
  const now = Date.now();
  const expiresAtMs = now + L.sessionTtlSec * 1000;

  const srcRef = db.collection(C.limits).doc(`asess_${srcKey}`);
  const globRef = db.collection(C.limits).doc(SIGNIN_GLOBAL_COUNTER_ID);
  const sessRef = db.collection(C.sessions).doc(sessionKey);

  const out = await db.runTransaction(async tx => {
    const [srcS, globS] = await tx.getAll(srcRef, globRef);
    const src = (srcS.data() ?? {}) as WindowCounter;
    const rej = checkWindows(src, now, L.sourceSessionsPerHour, L.sourceSessionsPerHour * 24, 'source');
    if (rej) return { rej };
    const used = windowCount((globS.data() as WindowCounter | undefined)?.h, now, HOUR_MS);
    const bits = adaptiveBits(L.powBits, L.powMaxBits, used, L.globalPerHour);
    const pow = { nonce: newPowNonce(), bits, expiresAtMs: Math.min(expiresAtMs, now + L.powTtlSec * 1000) };
    tx.set(srcRef, { ...applyWindows(src, now), updatedAt: FieldValue.serverTimestamp(), expireAt: Timestamp.fromMillis(now + 2 * 24 * HOUR_MS) });
    tx.create(sessRef, {
      sourceKey: srcKey, installKey, pow,
      codes: 0, dests: [], lastCodeAt: 0, activeChallengeId: null, lastRequest: null,
      appCheckPresent: !!request.app,
      createdAt: FieldValue.serverTimestamp(),
      expiresAtMs, expireAt: Timestamp.fromMillis(expiresAtMs + 24 * HOUR_MS),
    });
    return { pow };
  });

  if ('rej' in out && out.rej) {
    console.warn('[phoneAuth] session limited', { source: auditTag(srcKey), scope: out.rej.scope });
    throw new HttpsError('resource-exhausted', 'service-busy', { retryAfterSec: out.rej.retryAfterSec });
  }
  return { sessionToken, expiresAtMs, pow: (out as { pow: unknown }).pow };
}

export const startPhoneAuth = onCall(
  { region: REGION, secrets: [PHONE_HASH_PEPPER], ...appCheckOptions() },
  handleStartPhoneAuth,
);
