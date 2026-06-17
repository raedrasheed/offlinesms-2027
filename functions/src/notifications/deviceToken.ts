// Pure device-token helpers (provider-aware push). No Firestore / network here
// so token resolution + classification are unit-testable in isolation.
//
// OfflineSMS stores one doc per device at users/{uid}/devices/{deviceId}.
// Android registers a native FCM token (provider 'fcm'); iOS registers an Expo
// push token (provider 'expo') because the app uses the Firebase web JS SDK and
// can't mint an FCM token from APNs. Legacy docs (pre-iOS) carry only `fcmToken`
// and are treated as 'fcm'.

export type PushProvider = 'fcm' | 'expo';

export interface DeviceTokenDoc {
  pushToken?: string | null;   // canonical token (FCM or Expo)
  provider?: string | null;    // 'fcm' | 'expo'
  fcmToken?: string | null;    // legacy / Android back-compat
  enabled?: boolean;
}

export interface ResolvedToken { provider: PushProvider; token: string }

/** True for an Expo push token: ExponentPushToken[..] or ExpoPushToken[..]. */
export function isExpoPushToken(token: string | null | undefined): boolean {
  return typeof token === 'string' && /^Expo(nent)?PushToken\[.+\]$/.test(token.trim());
}

/**
 * Resolve the (provider, token) a device should be sent through, or null if the
 * doc has no usable token. Order of truth:
 *   1. explicit provider 'expo' → use pushToken (must be an Expo token).
 *   2. an Expo-shaped token in pushToken/fcmToken → 'expo' (defensive).
 *   3. otherwise → 'fcm' using pushToken ?? fcmToken (covers legacy Android).
 */
export function resolveDeviceToken(d: DeviceTokenDoc): ResolvedToken | null {
  const push = (d.pushToken ?? '').trim();
  const fcm = (d.fcmToken ?? '').trim();

  if (d.provider === 'expo') {
    const token = isExpoPushToken(push) ? push : isExpoPushToken(fcm) ? fcm : '';
    return token ? { provider: 'expo', token } : null;
  }

  // Defensive: an Expo token stored without provider still routes to Expo.
  if (isExpoPushToken(push)) return { provider: 'expo', token: push };
  if (isExpoPushToken(fcm)) return { provider: 'expo', token: fcm };

  const token = push || fcm;
  return token ? { provider: 'fcm', token } : null;
}

/** Does this device doc carry a usable push token (either provider)? */
export function deviceHasToken(d: DeviceTokenDoc): boolean {
  return resolveDeviceToken(d) !== null;
}
