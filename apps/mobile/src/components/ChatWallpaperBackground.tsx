// Absolute-fill chat wallpaper layer.
//
// - No custom wallpaper → the bundled default doodle background.
// - Custom wallpaper → the user's image.
// Memoised on `uri` so message-list re-renders don't reload the Image. A small
// theme-aware overlay keeps message text readable on bright wallpapers.

import { memo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';

// Bundled default chat background (WhatsApp-style doodle). Replace this file to
// change the app-wide default; the require path stays the same.
const DEFAULT_BG = require('../../assets/chat-bg-default.jpg');

type Props = { uri?: string };

function ChatWallpaperBackgroundBase({ uri }: Props) {
  // useTheme() subscribes to the theme context, so React re-renders this
  // component on theme switches even though props (`uri`) haven't changed.
  const { resolved } = useTheme();

  const source = uri ? { uri } : DEFAULT_BG;
  // Light: barely-there white wash. Dark: dim the bright doodle bg for contrast.
  const overlay = resolved === 'dark' ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.10)';

  return (
    <View style={StyleSheet.absoluteFill}>
      <Image
        source={source}
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
