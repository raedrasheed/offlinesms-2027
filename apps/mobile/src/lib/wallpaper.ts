// Chat wallpaper storage + resolution.
//
// The app supports a global wallpaper (Settings) and a per-conversation
// wallpaper (Chat details). Resolution order is:
//
//   per-chat wallpaper (if set)  →  global wallpaper  →  null (default theme bg)
//
// Persistence is offline-first: preferences are stored in AsyncStorage and the
// image is copied into the app's document directory (`wallpapers/`) so it
// survives gallery URI invalidation, app restart, and offline use.

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { resolveWallpaper, DEFAULT_PREF, type WallpaperPref } from './wallpaper.pure';

export { resolveWallpaper };
export type { WallpaperPref };

const STORAGE_PREFIX = 'wallpaper.v1.';
const GLOBAL_KEY     = STORAGE_PREFIX + 'global';
const CHAT_KEY       = (id: string) => STORAGE_PREFIX + 'chat.' + id;
const WALLPAPERS_DIR = FileSystem.documentDirectory + 'wallpapers/';

// Tiny pub/sub so the `useWallpaper` hook re-evaluates when any prefs change.
// Keyed by 'global' or 'chat.<id>'; subscribers receive the affected key.
type Listener = (key: string) => void;
const listeners = new Set<Listener>();
function emit(key: string) { for (const l of listeners) l(key); }

// ─── Read/write ──────────────────────────────────────────────────────────────

async function read(key: string): Promise<WallpaperPref | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WallpaperPref;
    if (parsed?.type === 'custom' && parsed.uri) return parsed;
    if (parsed?.type === 'default') return parsed;
    return null;
  } catch { return null; }
}

async function write(key: string, pref: WallpaperPref | null): Promise<void> {
  try {
    if (!pref) await AsyncStorage.removeItem(key);
    else       await AsyncStorage.setItem(key, JSON.stringify(pref));
  } catch { /* swallow */ }
  emit(key);
}

export async function getGlobalWallpaper(): Promise<WallpaperPref> {
  return (await read(GLOBAL_KEY)) ?? DEFAULT_PREF;
}

export async function setGlobalWallpaper(pref: WallpaperPref): Promise<void> {
  await write(GLOBAL_KEY, pref);
}

export async function getChatWallpaper(conversationId: string): Promise<WallpaperPref | null> {
  return read(CHAT_KEY(conversationId));
}

/** `null` clears the per-chat override so the chat falls back to global. */
export async function setChatWallpaper(conversationId: string, pref: WallpaperPref | null): Promise<void> {
  await write(CHAT_KEY(conversationId), pref);
}

// ─── File management ─────────────────────────────────────────────────────────

async function ensureDir(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(WALLPAPERS_DIR);
    if (!info.exists) await FileSystem.makeDirectoryAsync(WALLPAPERS_DIR, { intermediates: true });
  } catch { /* swallow */ }
}

function slug(scope: 'global' | string): string {
  return scope === 'global' ? 'global' : 'chat-' + scope.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Copy the picked image into the app's documents dir and return the new URI.
 *  Old wallpapers for the same scope are removed to avoid unbounded growth. */
async function persistImage(srcUri: string, scope: 'global' | string): Promise<string> {
  await ensureDir();
  const ext = (srcUri.match(/\.(jpg|jpeg|png|webp|heic)(\?|$)/i)?.[1] ?? 'jpg').toLowerCase();
  const dest = `${WALLPAPERS_DIR}${slug(scope)}-${Date.now()}.${ext}`;
  // Best-effort cleanup of any prior file for this scope.
  try {
    const entries = await FileSystem.readDirectoryAsync(WALLPAPERS_DIR);
    const prefix = slug(scope) + '-';
    await Promise.all(entries.filter(n => n.startsWith(prefix)).map(n => FileSystem.deleteAsync(WALLPAPERS_DIR + n, { idempotent: true })));
  } catch { /* swallow */ }
  await FileSystem.copyAsync({ from: srcUri, to: dest });
  return dest;
}

/** Launch the system image picker, persist the result locally, and save the
 *  preference. Returns the saved local URI, or null if the user cancelled.
 *  `scope` is `'global'` or a conversation id. */
export async function pickAndSaveWallpaper(scope: 'global' | string): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.85,           // reasonable size cap for memory/storage
    allowsEditing: false,
  });
  if (result.canceled || !result.assets?.[0]?.uri) return null;
  const localUri = await persistImage(result.assets[0].uri, scope);
  const pref: WallpaperPref = { type: 'custom', uri: localUri };
  if (scope === 'global') await setGlobalWallpaper(pref);
  else                    await setChatWallpaper(scope, pref);
  return localUri;
}

// ─── React hook ──────────────────────────────────────────────────────────────

/** Subscribe to the effective wallpaper for a chat (or globally when no id).
 *  Live-updates when either the per-chat or global preference changes. */
export function useWallpaper(conversationId?: string): WallpaperPref {
  const [pref, setPref] = useState<WallpaperPref>(DEFAULT_PREF);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const [chat, global] = await Promise.all([
        conversationId ? getChatWallpaper(conversationId) : Promise.resolve(null),
        getGlobalWallpaper(),
      ]);
      if (!cancelled) setPref(resolveWallpaper(chat, global));
    }
    refresh();
    const listener: Listener = key => {
      if (key === GLOBAL_KEY) refresh();
      if (conversationId && key === CHAT_KEY(conversationId)) refresh();
    };
    listeners.add(listener);
    return () => { cancelled = true; listeners.delete(listener); };
  }, [conversationId]);

  return pref;
}
