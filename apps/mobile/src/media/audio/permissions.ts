// Phase 23 — microphone permission helper (expo-av).

import { Audio } from 'expo-av';

export async function ensureMicPermission(): Promise<boolean> {
  try {
    const current = await Audio.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const req = await Audio.requestPermissionsAsync();
    return req.granted;
  } catch {
    return false;
  }
}
