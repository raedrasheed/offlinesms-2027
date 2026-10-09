// Callable: getPhoneLinkStatus — what the Settings screen needs to decide
// whether to show "Add phone number", and in which state. Authenticated, read-
// only, no SMS. While the feature is off (the production default) it returns
// only `{ available: false }`: the app then shows the entry as "Not available
// yet" (no other detail is disclosed) and never starts the flow.

import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { appCheckOptions } from '../lib/appCheck';
import { loadActiveRelayDevices } from '../sms/countryRouting';
import { supportedCountriesForDevices } from '../sms/relayLogic';
import { loadPhoneLinkConfig, phoneLinkSendingAllowed } from './config';
import { authFreshness, profileIsActive, PHONE_LINK_COLLECTIONS as C } from './gates';
import { maskPhone } from './crypto';
import { REGION } from './shared';

export async function handleGetPhoneLinkStatus(request: CallableRequest<unknown>) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'auth-required');
  const db = getFirestore();
  let cfg;
  try { cfg = await loadPhoneLinkConfig(db); } catch { return { available: false as const }; }
  if (!cfg.enabled) return { available: false as const };

  const user = await getAuth().getUser(uid);
  const [op, profile] = await Promise.all([
    db.collection(C.ops).doc(uid).get(),
    db.collection('users').doc(uid).get(),
  ]);
  const stage = op.exists ? (op.get('stage') as string) : null;
  const sending = phoneLinkSendingAllowed(cfg);
  const countries = sending && cfg.businessId
    ? supportedCountriesForDevices(await loadActiveRelayDevices(cfg.businessId), Date.now())
    : [];
  const token = request.auth!.token as { auth_time?: number };

  return {
    available: true as const,
    sendingPaused: !sending,
    linked: !!user.phoneNumber && (stage === null || stage === 'done' || stage === 'failed'),
    maskedPhone: user.phoneNumber ? maskPhone(user.phoneNumber) : null,
    pendingRecovery: stage === 'claimed' || stage === 'auth-updated',
    eligible: !user.disabled && !!user.email && user.emailVerified === true
      && profileIsActive(profile.exists, profile.get('status')),
    emailVerified: user.emailVerified === true,
    reauthRequired: authFreshness(token.auth_time, Date.now(), cfg.limits.reauthMaxAgeSec, user.tokensValidAfterTime) !== 'ok',
    countries,
    consentVersion: cfg.consentVersion,
    codeTtlSec: cfg.limits.codeTtlSec,
    resendAfterSec: Math.max(cfg.limits.accountCooldownSec, cfg.limits.destinationCooldownSec),
  };
}

export const getPhoneLinkStatus = onCall({ region: REGION, ...appCheckOptions() }, handleGetPhoneLinkStatus);
