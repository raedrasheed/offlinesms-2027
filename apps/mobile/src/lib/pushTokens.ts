// Pure push-token helpers — no native imports, so they load under vitest. The
// native registration in notifications.ts uses these to decide transport and to
// shape the Firestore device record.
//
// Android registers a native FCM token (provider 'fcm'); iOS registers an Expo
// push token (provider 'expo') because the app uses the Firebase web JS SDK and
// cannot mint an FCM token from APNs. The backend routes per provider.

export type PushProvider = 'fcm' | 'expo';
export type DevicePlatform = 'ios' | 'android' | 'web' | string;

/** Which transport a platform registers with. */
export function providerForPlatform(os: DevicePlatform): PushProvider {
  return os === 'ios' ? 'expo' : 'fcm';
}

/** iOS uses Expo push tokens; everything else uses the native device token. */
export function usesExpoToken(os: DevicePlatform): boolean {
  return providerForPlatform(os) === 'expo';
}

/** True for an Expo push token: ExponentPushToken[..] or ExpoPushToken[..]. */
export function isExpoPushToken(token: string | null | undefined): boolean {
  return typeof token === 'string' && /^Expo(nent)?PushToken\[.+\]$/.test(token.trim());
}

export interface DeviceRecordInput {
  deviceId: string;
  token: string;
  platform: DevicePlatform;
  appVersion?: string | null;
  buildVersion?: string | null;
  locale?: string | null;
  timezone?: string | null;
}

/**
 * Build the Firestore device record (merge payload) for users/{uid}/devices/
 * {deviceId}. `pushToken` + `provider` are the canonical fields; `fcmToken` is
 * still written for FCM devices so legacy backend reads keep working. Timestamps
 * are added by the caller (serverTimestamp) — kept out here so this stays pure.
 */
export function buildDeviceRecord(input: DeviceRecordInput): Record<string, unknown> {
  const provider = providerForPlatform(input.platform);
  return {
    deviceId: input.deviceId,
    pushToken: input.token,
    provider,
    // Back-compat: only an actual FCM token belongs in fcmToken.
    fcmToken: provider === 'fcm' ? input.token : null,
    platform: input.platform,
    appVersion: input.appVersion ?? null,
    buildVersion: input.buildVersion ?? null,
    locale: input.locale ?? null,
    timezone: input.timezone ?? null,
    enabled: true,
  };
}
