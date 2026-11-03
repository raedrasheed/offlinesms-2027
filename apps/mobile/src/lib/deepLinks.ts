// Deep-link handling for group invite links (Phase 26).
//
// A link can arrive while the user is logged OUT (RootStack, and thus the
// JoinGroup screen, isn't mounted yet). We stash the invite code and replay it
// once the user is authenticated + onboarded. Stash is persisted so it also
// survives the login flow's remounts and cold starts.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseInviteCode } from './invite';
import { validClipId } from './clipReference';

const PENDING_KEY = 'pendingInvite.v1';
const PENDING_CLIP_KEY = 'pendingClip.v1';

export async function setPendingClip(clipId: string): Promise<void> {
  if (validClipId(clipId)) await AsyncStorage.setItem(PENDING_CLIP_KEY, clipId).catch(() => {});
}

export async function takePendingClip(): Promise<string | null> {
  try {
    const id = await AsyncStorage.getItem(PENDING_CLIP_KEY);
    if (id) await AsyncStorage.removeItem(PENDING_CLIP_KEY);
    return validClipId(id) ? id : null;
  } catch { return null; }
}

export function inviteCodeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return parseInviteCode(url);
}

export async function setPendingInvite(code: string): Promise<void> {
  try { await AsyncStorage.setItem(PENDING_KEY, code); } catch { /* noop */ }
}

export async function takePendingInvite(): Promise<string | null> {
  try {
    const code = await AsyncStorage.getItem(PENDING_KEY);
    if (code) await AsyncStorage.removeItem(PENDING_KEY);
    return code;
  } catch { return null; }
}
