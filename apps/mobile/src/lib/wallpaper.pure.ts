// Pure wallpaper resolution — no React-Native or Expo imports, so it loads
// cleanly under vitest (the rest of `wallpaper.ts` pulls in expo-file-system /
// expo-image-picker / AsyncStorage which don't resolve in a Node test env).

export type WallpaperPref =
  | { type: 'default' }
  | { type: 'custom'; uri: string };

export const DEFAULT_PREF: WallpaperPref = { type: 'default' };

/** Resolve the effective wallpaper for a chat:
 *    explicit per-chat custom  →  explicit per-chat default (opt out of global)
 *    →  global custom  →  default. */
export function resolveWallpaper(
  chat: WallpaperPref | null | undefined,
  global: WallpaperPref | null | undefined,
): WallpaperPref {
  if (chat && chat.type === 'custom') return chat;
  if (chat && chat.type === 'default') return DEFAULT_PREF;
  if (global && global.type === 'custom') return global;
  return DEFAULT_PREF;
}
