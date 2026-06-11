import { describe, it, expect } from 'vitest';
import { resolveWallpaper, type WallpaperPref } from '../src/lib/wallpaper.pure';

const def: WallpaperPref = { type: 'default' };
const customA: WallpaperPref = { type: 'custom', uri: 'file://a.jpg' };
const customB: WallpaperPref = { type: 'custom', uri: 'file://b.jpg' };

describe('resolveWallpaper', () => {
  it('falls back to default when nothing is set', () => {
    expect(resolveWallpaper(null, null)).toEqual(def);
    expect(resolveWallpaper(undefined, undefined)).toEqual(def);
  });

  it('uses the global wallpaper when no per-chat override exists', () => {
    expect(resolveWallpaper(null, customA)).toEqual(customA);
  });

  it('per-chat custom wins over the global wallpaper', () => {
    expect(resolveWallpaper(customA, customB)).toEqual(customA);
  });

  it('an explicit per-chat "default" overrides the global wallpaper', () => {
    // The chat picker offers "Use default" which is `{ type: 'default' }` —
    // it must NOT inherit a global custom wallpaper.
    expect(resolveWallpaper(def, customB)).toEqual(def);
  });

  it('null per-chat (no override) DOES inherit the global wallpaper', () => {
    expect(resolveWallpaper(null, customB)).toEqual(customB);
  });
});
