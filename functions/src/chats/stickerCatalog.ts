// Stickers the server accepts. A sticker message carries only {packId,
// stickerId}; the image ships with the app (or a future pack's own source), so
// a client can never inject an arbitrary image URL into a conversation.
// Must match apps/mobile/assets/stickers/<pack>/pack.json (checked by a test).

export interface StickerDef { id: string; alt: string }

export const STICKER_PACKS: Record<string, StickerDef[]> = {
  simsim: [
    { id: 'hi', alt: '👋' }, { id: 'love', alt: '😍' }, { id: 'laugh', alt: '😂' },
    { id: 'thumbs', alt: '👍' }, { id: 'sad', alt: '😢' }, { id: 'angry', alt: '😠' },
    { id: 'sleepy', alt: '😴' }, { id: 'party', alt: '🥳' }, { id: 'thinking', alt: '🤔' },
    { id: 'wow', alt: '😮' }, { id: 'coffee', alt: '☕' }, { id: 'heart', alt: '❤️' },
    { id: 'thanks_ar', alt: '🙏' }, { id: 'hello_ar', alt: '👋' }, { id: 'thanks_en', alt: '🙏' },
    { id: 'ok_en', alt: '👌' },
  ],
};

export function findSticker(packId: unknown, stickerId: unknown): (StickerDef & { packId: string }) | null {
  if (typeof packId !== 'string' || typeof stickerId !== 'string') return null;
  const pack = Object.prototype.hasOwnProperty.call(STICKER_PACKS, packId) ? STICKER_PACKS[packId] : undefined;
  const st = pack?.find(s => s.id === stickerId);
  return st ? { ...st, packId } : null;
}
