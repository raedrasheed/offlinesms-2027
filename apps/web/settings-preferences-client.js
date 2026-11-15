const accountDefaults = Object.freeze({ smsOptOut: false, inAppNotifications: true });

export const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  enabled: true,
  directMessages: true,
  groupMessages: true,
  reactions: true,
  sound: true,
  vibration: true,
  showPreview: true,
});

function normalizePreferences(data, defaults) {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [
    key, typeof data?.[key] === 'boolean' ? data[key] : fallback,
  ]));
}

export const normalizeAccountAlertPreferences = data => normalizePreferences(data, accountDefaults);
export const normalizeNotificationPreferences = data => normalizePreferences(data, DEFAULT_NOTIFICATION_PREFERENCES);

function validatedPatch(patch, defaults) {
  const entries = Object.entries(patch ?? {});
  if (!entries.length || entries.some(([key, value]) => !Object.hasOwn(defaults, key) || typeof value !== 'boolean')) {
    throw Object.assign(new Error('invalid-notification-preferences'), { code: 'invalid-notification-preferences' });
  }
  return Object.fromEntries(entries);
}

export function createSettingsPreferencesClient({ sdk, db, currentUid, requireSession, watchScoped }) {
  const notificationsRef = uid => sdk.doc(db, 'users', uid, 'notificationSettings', 'current');

  return {
    async updateAccountAlertPreferences(patch) {
      const uid = currentUid();
      const data = validatedPatch(patch, accountDefaults);
      await sdk.updateDoc(sdk.doc(db, 'users', uid), { ...data, updatedAt: sdk.serverTimestamp() });
      requireSession(uid);
    },

    watchNotificationPreferences(uid, onSettings, onError) {
      requireSession(uid);
      return watchScoped(uid, notificationsRef(uid), snapshot => {
        if (!snapshot.metadata?.hasPendingWrites) {
          onSettings(normalizeNotificationPreferences(snapshot.data()));
        }
      }, onError);
    },

    async getNotificationPreferences() {
      const uid = currentUid();
      const snapshot = await sdk.getDocFromServer(notificationsRef(uid));
      requireSession(uid);
      return normalizeNotificationPreferences(snapshot.data());
    },

    async updateNotificationPreferences(patch) {
      const uid = currentUid();
      const data = validatedPatch(patch, DEFAULT_NOTIFICATION_PREFERENCES);
      await sdk.setDoc(notificationsRef(uid), { ...data, updatedAt: sdk.serverTimestamp() }, { merge: true });
      requireSession(uid);
    },
  };
}
