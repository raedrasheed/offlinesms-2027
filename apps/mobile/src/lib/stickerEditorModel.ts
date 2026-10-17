// Normalized, device-independent edit recipe. Saved separately from the output
// so re-editing always starts from the imported image, never a flattened export.
export const STICKER_EDGE = 512;
export const STICKER_LIBRARY_MAX = 100;
export const STICKER_COLORS = ['#FFFFFF', '#111111', '#FFDD33', '#FF5252', '#34B7F1', '#60D394'] as const;
export interface StickerEdits {
  rotation: number; flipX: boolean; flipY: boolean;
  fit: 'contain' | 'cover'; zoom: number; x: number; y: number;
  shape: 'square' | 'circle'; text: string; color: string;
  textPosition: 'top' | 'center' | 'bottom'; textSize: number;
}
export const DEFAULT_STICKER_EDITS: StickerEdits = {
  rotation: 0, flipX: false, flipY: false, fit: 'contain', zoom: 1, x: 0, y: 0,
  shape: 'square', text: '', color: '#FFFFFF', textPosition: 'bottom', textSize: 0.1,
};
const clamp = (n: unknown, min: number, max: number, fallback: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
export function cleanStickerEdits(value: Partial<StickerEdits> | null | undefined): StickerEdits {
  const v = value ?? {};
  return {
    rotation: [0, 90, 180, 270].includes(v.rotation!) ? v.rotation! : 0,
    flipX: v.flipX === true, flipY: v.flipY === true,
    fit: v.fit === 'cover' ? 'cover' : 'contain', zoom: clamp(v.zoom, 1, 4, 1),
    x: clamp(v.x, -1, 1, 0), y: clamp(v.y, -1, 1, 0), shape: v.shape === 'circle' ? 'circle' : 'square',
    text: typeof v.text === 'string' ? v.text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, 80) : '',
    color: (STICKER_COLORS as readonly string[]).includes(v.color!) ? v.color! : '#FFFFFF',
    textPosition: v.textPosition === 'top' || v.textPosition === 'center' ? v.textPosition : 'bottom',
    textSize: clamp(v.textSize, 0.07, 0.15, 0.1),
  };
}
/** Dimensions are those of the already rotated/flipped source. */
export function stickerImageLayout(width: number, height: number, side: number, edits: StickerEdits) {
  if (![width, height, side].every(n => Number.isFinite(n) && n > 0)) throw Error('sticker-invalid');
  const scale = (edits.fit === 'cover' ? Math.max(side / width, side / height) : Math.min(side / width, side / height)) * edits.zoom;
  const w = width * scale, h = height * scale;
  const rangeX = Math.abs(w - side) / 2, rangeY = Math.abs(h - side) / 2;
  return { width: w, height: h, left: (side - w) / 2 + edits.x * rangeX,
    top: (side - h) / 2 + edits.y * rangeY, rangeX, rangeY };
}
