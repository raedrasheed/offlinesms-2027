// A sticker message: the bundled image, chromeless on the wallpaper. A sticker
// from a pack this app version doesn't have falls back to its emoji, so a
// newer sender never produces an empty bubble.

import { memo } from 'react';
import { Image, Text, View, StyleSheet } from 'react-native';
import type { StickerRef } from '../../lib/pollModel';
import { findSticker } from '../../lib/stickers';
import { STICKER_SOURCES } from './stickerSources';

export const STICKER_SIZE = 148;

export const StickerBubble = memo(function StickerBubble({ sticker, fallbackText }: { sticker: StickerRef | null | undefined; fallbackText?: string }) {
  const def = sticker ? findSticker(sticker.packId, sticker.stickerId) : null;
  const src = def ? STICKER_SOURCES[def.packId]?.[def.id] : undefined;
  if (!src) {
    return (
      <View style={s.fallback} accessibilityLabel={sticker?.alt ?? fallbackText ?? ''}>
        <Text style={s.fallbackEmoji}>{sticker?.alt || fallbackText || '🙂'}</Text>
      </View>
    );
  }
  return (
    <Image
      source={src}
      style={s.img}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel={`${def!.en} · ${def!.ar}`}
    />
  );
});

const s = StyleSheet.create({
  img:           { width: STICKER_SIZE, height: STICKER_SIZE },
  fallback:      { width: STICKER_SIZE, height: STICKER_SIZE, alignItems: 'center', justifyContent: 'center' },
  fallbackEmoji: { fontSize: 88 },
});
