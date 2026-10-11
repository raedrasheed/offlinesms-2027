// Preserve pictographic/ZWJ support and admit complete flag/keycap sequences.
// Regional indicators are not Extended_Pictographic; keycaps contain a digit.
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const HAS_ALNUM = /[\p{L}\p{N}]/u;
const FLAG = /^[\u{1F1E6}-\u{1F1FF}]{2}$/u;
const KEYCAP = /^[0-9#*]\uFE0F?\u20E3$/u;
// U+2139 is classified as a letter despite being a standard emoji base.
const INFO = /^ℹ\uFE0F?$/u;

export function isAllowedReactionEmoji(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v.length === 0 || v.length > 16) return false;
  if (FLAG.test(v) || KEYCAP.test(v) || INFO.test(v)) return true;
  if (HAS_ALNUM.test(v)) return false;
  return PICTOGRAPHIC.test(v);
}
