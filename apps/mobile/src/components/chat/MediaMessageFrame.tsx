import type { ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { colors } from '../../theme';
import { fitMediaDimensions, type MediaDimensions } from '../../media/mediaDimensions';

/** One visual contract for photos and videos: dimensions, corners, caption and receipt pill. */
export function MediaMessageFrame({ dimensions, caption, footer, children, onPress, onLongPress, label }: {
  dimensions: MediaDimensions | null;
  caption?: string | null;
  footer?: ReactNode;
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  label: string;
}) {
  const window = useWindowDimensions();
  // Conversation has 12px gutters, an 80% column and a 10px media-card mat.
  // The second bound also leaves room for the received group avatar on small screens.
  const maxWidth = Math.min(230, (window.width - 24) * 0.8 - 10, window.width - 70);
  const size = fitMediaDimensions(dimensions, maxWidth, Math.min(420, window.height * 0.65));
  return <View style={{ width: size.width }}>
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={300}
      accessibilityRole="imagebutton" accessibilityLabel={label} style={[mediaFrameStyles.frame, size]}>
      {children}
      {footer ? <View pointerEvents="none" style={mediaFrameStyles.footerOverlay}>{footer}</View> : null}
    </Pressable>
    {caption?.trim() ? <Text style={mediaFrameStyles.caption}>{caption.trim()}</Text> : null}
  </View>;
}

export const mediaFrameStyles = StyleSheet.create({
  frame: { borderRadius: 14, overflow: 'hidden', backgroundColor: colors.ink100 },
  content: { width: '100%', height: '100%' },
  placeholder: { backgroundColor: colors.primaryTint },
  footerOverlay: { position: 'absolute', right: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.4)' },
  caption: { fontSize: 15, color: colors.ink, marginTop: 6, lineHeight: 21 },
});
