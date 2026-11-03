import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { auth } from './firebase';

export type ClipDraftAudience = 'public' | 'followers' | 'group' | 'private';
export interface ClipDraft {
  id: string; uid: string; localUri: string; mimeType: string; sizeBytes: number; durationMs: number;
  caption: string; audience: ClipDraftAudience | null; groupId: string | null;
  allowComments: boolean; allowDownload: boolean; trimStartMs: number; trimEndMs: number;
  overlayText: string; mute: boolean; coverTimeMs: number; createdAtMs: number; updatedAtMs: number;
  clipId?: string; status: 'draft' | 'uploading' | 'uploaded' | 'processing' | 'failed'; errorCode?: string;
}
const key = (uid: string) => `clips.drafts.v1.${uid}`;
function uidNow(): string { const uid = auth.currentUser?.uid; if (!uid) throw new Error('sign-in-required'); return uid; }
function directory(uid: string): string {
  if (!FileSystem.documentDirectory) throw new Error('clip-drafts-unavailable');
  return `${FileSystem.documentDirectory}clip-drafts/${encodeURIComponent(uid)}/`;
}
let writes = Promise.resolve();
function serialize<T>(run: () => Promise<T>): Promise<T> {
  const result = writes.then(run); writes = result.then(() => undefined, () => undefined); return result;
}
async function load(uid: string): Promise<ClipDraft[]> {
  try {
    const data = JSON.parse(await AsyncStorage.getItem(key(uid)) ?? '[]');
    return Array.isArray(data) ? data.filter(x => x && x.uid === uid && typeof x.id === 'string' && typeof x.localUri === 'string') : [];
  } catch { return []; }
}
function assertSession(uid: string) { if (auth.currentUser?.uid !== uid) throw new Error('clip-session-changed'); }

/** Copy picker/cache bytes into the account's document directory before
 * showing a saved draft. Picker cache eviction cannot silently destroy it. */
export async function createClipDraft(media: { uri: string; mimeType?: string; durationMs?: number; sizeBytes?: number }): Promise<ClipDraft> {
  const uid = uidNow(), id = Crypto.randomUUID(), folder = directory(uid);
  await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
  const extension = media.mimeType === 'video/quicktime' ? 'mov' : media.mimeType === 'video/webm' ? 'webm' : 'mp4';
  const localUri = `${folder}${id}.${extension}`;
  await FileSystem.copyAsync({ from: media.uri, to: localUri });
  try {
    assertSession(uid);
    const file = await FileSystem.getInfoAsync(localUri, { size: true });
    if (!file.exists || !('size' in file) || file.size <= 0) throw new Error('clip-file-missing');
    const durationMs = Math.max(0, Math.floor(media.durationMs ?? 0));
    const now = Date.now();
    const draft: ClipDraft = { id, uid, localUri, mimeType: media.mimeType ?? 'video/mp4', sizeBytes: file.size,
      durationMs, caption: '', audience: null, groupId: null, allowComments: true, allowDownload: false,
      trimStartMs: 0, trimEndMs: Math.min(durationMs, 60_000), overlayText: '', mute: false, coverTimeMs: 0,
      createdAtMs: now, updatedAtMs: now, status: 'draft' };
    return await saveClipDraft(draft);
  } catch (error) { await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {}); throw error; }
}
export async function saveClipDraft(draft: ClipDraft): Promise<ClipDraft> {
  const uid = uidNow();
  if (draft.uid !== uid || !draft.localUri.startsWith(directory(uid))) throw new Error('clip-draft-owner-mismatch');
  return serialize(async () => {
    assertSession(uid); const rows = await load(uid); assertSession(uid);
    const value = { ...draft, updatedAtMs: Date.now() };
    await AsyncStorage.setItem(key(uid), JSON.stringify([value, ...rows.filter(x => x.id !== value.id)]));
    return value;
  });
}
export async function listClipDrafts(): Promise<ClipDraft[]> {
  const uid = uidNow(); await writes; const rows = await load(uid); assertSession(uid);
  return rows.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}
export async function getClipDraft(id: string): Promise<ClipDraft | null> {
  return (await listClipDrafts()).find(x => x.id === id) ?? null;
}
export async function deleteClipDraft(id: string): Promise<void> {
  const uid = uidNow();
  return serialize(async () => {
    assertSession(uid); const rows = await load(uid), draft = rows.find(x => x.id === id); assertSession(uid);
    await AsyncStorage.setItem(key(uid), JSON.stringify(rows.filter(x => x.id !== id)));
    if (draft?.localUri.startsWith(directory(uid))) await FileSystem.deleteAsync(draft.localUri, { idempotent: true });
  });
}
/** Explicit account-deletion cleanup. Sign-out keeps drafts isolated for the
 * same account's next sign-in; another account never loads these entries. */
export async function clearClipDraftsForAccount(uid: string): Promise<void> {
  await serialize(async () => {
    await AsyncStorage.removeItem(key(uid));
    await AsyncStorage.removeItem(`clips.preferences.v1:${uid}`);
    await FileSystem.deleteAsync(directory(uid), { idempotent: true });
  });
}
