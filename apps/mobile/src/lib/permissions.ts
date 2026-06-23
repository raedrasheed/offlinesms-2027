// Permission helpers — thin wrappers around each Expo permission module.
//
// We keep these in one place so screens don't have to import each
// individual module and so the toggle UI can treat them uniformly.

import * as Contacts from 'expo-contacts';
import * as Notifications from 'expo-notifications';
import { Camera } from 'expo-camera';
import { Audio } from 'expo-av';

export type PermissionKey = 'contacts' | 'notifications' | 'camera' | 'microphone';
export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

function mapStatus(s: string | undefined): PermissionStatus {
  if (s === 'granted') return 'granted';
  if (s === 'denied') return 'denied';
  return 'undetermined';
}

export async function getStatus(key: PermissionKey): Promise<PermissionStatus> {
  switch (key) {
    case 'contacts':      return mapStatus((await Contacts.getPermissionsAsync()).status);
    case 'notifications': return mapStatus((await Notifications.getPermissionsAsync()).status);
    case 'camera':        return mapStatus((await Camera.getCameraPermissionsAsync()).status);
    case 'microphone':    return mapStatus((await Audio.getPermissionsAsync()).status);
  }
}

export async function request(key: PermissionKey): Promise<PermissionStatus> {
  switch (key) {
    case 'contacts':      return mapStatus((await Contacts.requestPermissionsAsync()).status);
    case 'notifications': return mapStatus((await Notifications.requestPermissionsAsync({
      // iOS: explicitly request alert + sound + badge (Android ignores these).
      ios: { allowAlert: true, allowSound: true, allowBadge: true },
    })).status);
    case 'camera':        return mapStatus((await Camera.requestCameraPermissionsAsync()).status);
    case 'microphone':    return mapStatus((await Audio.requestPermissionsAsync()).status);
  }
}
