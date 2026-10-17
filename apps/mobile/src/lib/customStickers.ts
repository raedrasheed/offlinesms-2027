import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FS from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { cleanStickerEdits, STICKER_LIBRARY_MAX, type StickerEdits } from './stickerEditorModel';

export interface CustomSticker {
  id: string; revision: string; name: string; createdAt: number; updatedAt: number;
  sourceWidth: number; sourceHeight: number; sizeBytes: number; edits: StickerEdits;
}
const safeId = (s: unknown): s is string => typeof s === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(s);
const key = (uid: string) => `customStickers.v1:${uid}`;
function directory(uid: string) {
  if (!uid || !FS.documentDirectory) throw Error('sticker-storage-unavailable');
  return `${FS.documentDirectory}OfflineSMS/Stickers/account-${encodeURIComponent(uid)}/`;
}
export function customStickerUri(uid: string, sticker: CustomSticker, source = false) {
  if (!safeId(sticker.id) || !safeId(sticker.revision)) throw Error('sticker-invalid');
  return `${directory(uid)}${sticker.id}-${sticker.revision}-${source ? 'source' : 'sticker'}.png`;
}
export async function loadCustomStickers(uid: string): Promise<CustomSticker[]> {
  directory(uid);
  const raw = await AsyncStorage.getItem(key(uid));
  if (!raw) return [];
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw Error('sticker-library-invalid');
  return data.filter((s: any) => s && safeId(s.id) && safeId(s.revision)
    && Number.isFinite(s.sourceWidth) && s.sourceWidth > 0 && s.sourceWidth <= 1024
    && Number.isFinite(s.sourceHeight) && s.sourceHeight > 0 && s.sourceHeight <= 1024
    && Number.isSafeInteger(s.sizeBytes) && s.sizeBytes > 0 && s.sizeBytes <= 2 * 1024 * 1024)
    .slice(0, STICKER_LIBRARY_MAX).map((s: any) => ({
      id: s.id, revision: s.revision, name: typeof s.name === 'string' ? s.name.slice(0, 60) : '',
      createdAt: Number(s.createdAt) || 0, updatedAt: Number(s.updatedAt) || 0,
      sourceWidth: s.sourceWidth, sourceHeight: s.sourceHeight, sizeBytes: s.sizeBytes,
      edits: cleanStickerEdits(s.edits),
    }));
}
// Serialise mutations per account, including a save followed immediately by a
// delete. Publish the manifest only after BOTH durable files have been copied.
const pending = new Map<string, Promise<unknown>>();
function serial<T>(uid: string, work: () => Promise<T>): Promise<T> {
  const task = (pending.get(uid) ?? Promise.resolve()).catch(() => {}).then(work);
  pending.set(uid, task);
  void task.finally(() => { if (pending.get(uid) === task) pending.delete(uid); }).catch(() => {});
  return task;
}
async function removeFiles(uid: string, sticker: CustomSticker) {
  await Promise.all([false, true].map(source => FS.deleteAsync(customStickerUri(uid, sticker, source), { idempotent: true }).catch(() => {})));
}
export function saveCustomSticker(uid: string, input: {
  previous?: CustomSticker; name: string; sourceUri: string; imageUri: string;
  sourceWidth: number; sourceHeight: number; edits: StickerEdits;
}): Promise<CustomSticker[]> {
  return serial(uid, async () => {
    const list = await loadCustomStickers(uid);
    const previous = input.previous ? list.find(s => s.id === input.previous!.id) : undefined;
    if (input.previous && previous?.revision !== input.previous.revision) throw Error('sticker-changed');
    if (!previous && list.length >= STICKER_LIBRARY_MAX) throw Error('sticker-library-full');
    const image = await FS.getInfoAsync(input.imageUri), source = await FS.getInfoAsync(input.sourceUri);
    if (!image.exists || image.isDirectory || image.size <= 0 || image.size > 2 * 1024 * 1024
      || !source.exists || source.isDirectory || source.size <= 0 || source.size > 5 * 1024 * 1024
      || ![input.sourceWidth, input.sourceHeight].every(n => Number.isSafeInteger(n) && n > 0 && n <= 1024)) throw Error('sticker-invalid');
    const now = Date.now();
    const sticker: CustomSticker = { id: previous?.id ?? randomUUID(), revision: randomUUID(),
      name: input.name.trim().slice(0, 60), createdAt: previous?.createdAt ?? now, updatedAt: now,
      sourceWidth: input.sourceWidth, sourceHeight: input.sourceHeight, sizeBytes: image.size,
      edits: cleanStickerEdits(input.edits) };
    await FS.makeDirectoryAsync(directory(uid), { intermediates: true });
    const next = [sticker, ...list.filter(s => s.id !== sticker.id)];
    try {
      await FS.copyAsync({ from: input.sourceUri, to: customStickerUri(uid, sticker, true) });
      await FS.copyAsync({ from: input.imageUri, to: customStickerUri(uid, sticker) });
      await AsyncStorage.setItem(key(uid), JSON.stringify(next));
    } catch (error) { await removeFiles(uid, sticker); throw error; }
    if (previous) await removeFiles(uid, previous);
    return next;
  });
}
export function deleteCustomSticker(uid: string, id: string): Promise<CustomSticker[]> {
  return serial(uid, async () => {
    const list = await loadCustomStickers(uid), old = list.find(s => s.id === id);
    const next = list.filter(s => s.id !== id);
    await AsyncStorage.setItem(key(uid), JSON.stringify(next));
    if (old) await removeFiles(uid, old);
    return next;
  });
}
