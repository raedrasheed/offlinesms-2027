// 3D animated emoji registry — pure data + matching only (no React-Native
// imports, so it loads cleanly under vitest). The PNG require() map and the
// animation loops live in components/chat/AnimatedEmoji3D.tsx.
//
// A text message whose ENTIRE content is one of these emojis renders as a
// large animated 3D emoji in the bubble (WhatsApp/Telegram style). The
// message text stays the plain unicode emoji, so previews, notifications
// and older clients all degrade gracefully.

/** Motion style per mood — distinct movement for happy/sad/angry/etc. */
export type EmojiMood = 'bounce' | 'pulse' | 'shake' | 'droop' | 'wiggle';

export type Emoji3D = {
  key:  string;     // asset name in assets/emoji3d/<key>.png
  char: string;     // the unicode emoji as typed/sent
  mood: EmojiMood;
};

export const EMOJI_3D: readonly Emoji3D[] = [
  { key: 'happy',    char: '😀', mood: 'bounce' },
  { key: 'laugh',    char: '😂', mood: 'bounce' },
  { key: 'love',     char: '😍', mood: 'pulse'  },
  { key: 'cool',     char: '😎', mood: 'wiggle' },
  { key: 'wink',     char: '😉', mood: 'wiggle' },
  { key: 'sad',      char: '😢', mood: 'droop'  },
  { key: 'cry',      char: '😭', mood: 'droop'  },
  { key: 'angry',    char: '😠', mood: 'shake'  },
  { key: 'wow',      char: '😲', mood: 'pulse'  },
  { key: 'think',    char: '🤔', mood: 'wiggle' },
  { key: 'sleep',    char: '😴', mood: 'droop'  },
  { key: 'party',    char: '🥳', mood: 'bounce' },
  { key: 'thumbsup', char: '👍', mood: 'bounce' },
  { key: 'heart',    char: '❤️', mood: 'pulse'  },
  { key: 'fire',     char: '🔥', mood: 'pulse'  },
  { key: 'clap',     char: '👏', mood: 'shake'  },
] as const;

/** Strip whitespace + variation selectors so '❤️' and '❤' both match. */
function normalize(text: string): string {
  return text.trim().replace(/[\uFE0E\uFE0F]/g, '');
}

const BY_CHAR = new Map(EMOJI_3D.map(e => [normalize(e.char), e]));

/**
 * If `text` consists of exactly one supported emoji (ignoring surrounding
 * whitespace and variation selectors), return its registry entry; else null.
 */
export function matchAnimatedEmoji(text: string | null | undefined): Emoji3D | null {
  if (!text) return null;
  return BY_CHAR.get(normalize(text)) ?? null;
}
