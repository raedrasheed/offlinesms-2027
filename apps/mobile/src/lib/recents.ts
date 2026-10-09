// "Recently used" lists (emoji, stickers) — most-recent first, de-duplicated,
// capped, persisted per user on the device only (AsyncStorage).

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Pure: put `item` first, drop its older copy, keep at most `max`. */
export function pushRecent<T>(list: readonly T[], item: T, max: number, same: (a: T, b: T) => boolean = (a, b) => a === b): T[] {
  return [item, ...list.filter(x => !same(x, item))].slice(0, max);
}

export interface RecentStore<T> {
  load(): Promise<T[]>;
  add(item: T): Promise<T[]>;
}

export function createRecentStore<T>(key: string, max: number, same?: (a: T, b: T) => boolean): RecentStore<T> {
  let mem: T[] | null = null;
  return {
    async load() {
      if (mem) return mem;
      try {
        const raw = await AsyncStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        mem = Array.isArray(parsed) ? parsed.slice(0, max) : [];
      } catch { mem = []; }
      return mem!;
    },
    async add(item) {
      const next = pushRecent(await this.load(), item, max, same);
      mem = next;
      try { await AsyncStorage.setItem(key, JSON.stringify(next)); } catch { /* best-effort */ }
      return next;
    },
  };
}
