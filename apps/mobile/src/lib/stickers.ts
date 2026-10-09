// Sticker packs available in the composer — pure data (unit-tested). The pack
// manifest is generated with the artwork (scripts/stickers/build-stickers.mjs);
// the server accepts exactly these ids (functions/src/chats/stickerCatalog.ts).

import simsim from '../../assets/stickers/simsim/pack.json';

export interface StickerDef { id: string; alt: string; en: string; ar: string }
export interface StickerPack { id: string; version: number; license: string; stickers: StickerDef[] }

export const STICKER_PACKS: StickerPack[] = [simsim as StickerPack];

export function findSticker(packId: string | undefined, stickerId: string | undefined): (StickerDef & { packId: string }) | null {
  const pack = STICKER_PACKS.find(p => p.id === packId);
  const st = pack?.stickers.find(s => s.id === stickerId);
  return st ? { ...st, packId: pack!.id } : null;
}

/** Recents are stored as "pack/id" keys. */
export const stickerKey = (packId: string, stickerId: string) => `${packId}/${stickerId}`;
export function parseStickerKey(key: string): { packId: string; stickerId: string } | null {
  const i = key.indexOf('/');
  if (i <= 0) return null;
  const r = { packId: key.slice(0, i), stickerId: key.slice(i + 1) };
  return findSticker(r.packId, r.stickerId) ? r : null;
}
