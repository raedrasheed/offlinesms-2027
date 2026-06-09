// Absolute-fill chat wallpaper layer.
//
// Memoised on `uri` so message-list re-renders don't reload the Image. A small
// theme-aware overlay keeps message text readable on bright photo wallpapers.

import { memo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';

type Props = { uri?: string };

function ChatWallpaperBackgroundBase({ uri }: Props) {
  // useTheme() subscribes to the theme context, so React re-renders this
  // component on theme switches even though props (`uri`) haven't changed.
  const { resolved } = useTheme();
  const fallback = resolved === 'dark' ? '#0B1620' : '#EAF2FB';

  if (!uri) {
    return <View style={[StyleSheet.absoluteFill, { backgroundColor: fallback }]} />;
  }

  const overlay = resolved === 'dark' ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.18)';
  return (
    <View style={StyleSheet.absoluteFill}>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        fadeDuration={0}                       // keep the bitmap; no decode on re-mount
        accessibilityIgnoresInvertColors
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: overlay }]} pointerEvents="none" />
    </View>
  );
}

// Memo gate so message-list re-renders (every new message, every scroll tick)
// don't bounce the Image.
export const ChatWallpaperBackground = memo(
  ChatWallpaperBackgroundBase,
  (a, b) => a.uri === b.uri,
);
