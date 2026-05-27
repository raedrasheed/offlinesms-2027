// Phase 23 — image message content (rendered inside MessageBubble).
//
// Shows the picked/uploaded image with a rounded frame, an upload-progress or
// retry overlay while the binary is in flight, and the optional caption. Tapping
// opens the full-screen viewer. Footer (time/ticks) and long-press actions are
// owned by the surrounding MessageBubble.

import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../../theme';
import type { Message } from '../../lib/conversations';
import { MediaUploadProgress } from './MediaUploadProgress';

const MAX_W = 230;
const MAX_H = 280;

export function ImageMessageBubble({
  message, mine, onOpen, onRetry,
}: {
  message: Message;
  mine: boolean;
  onOpen: (uri: string) => void;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const media = message.media;
  const uri = media?.downloadURL || media?.localUri || null;

  // Frame height from aspect ratio when known, else a sensible default box.
  let h = 170;
  if (media?.width && media?.height && media.width > 0) {
    h = Math.round(MAX_W * (media.height / media.width));
    h = Math.max(120, Math.min(MAX_H, h));
  }

  const status = media?.uploadStatus ?? 'uploaded';
  const uploading = status === 'pending' || status === 'uploading';
  const failed = status === 'failed';
  const caption = message.caption?.trim();

  return (
    <View>
      <Pressable
        onPress={() => uri && !uploading && !failed && onOpen(uri)}
        accessibilityRole="imagebutton"
        accessibilityLabel={t('media.openImage')}
        style={[s.frame, { width: MAX_W, height: h }]}
      >
        {uri ? (
          <Image source={{ uri }} style={s.image} resizeMode="cover" />
        ) : (
          <View style={[s.image, s.placeholder]} />
        )}
        {uploading ? (
          <MediaUploadProgress progress={media?.uploadProgress ?? 0} />
        ) : null}
        {failed ? (
          <MediaUploadProgress progress={0} failed onRetry={onRetry} />
        ) : null}
      </Pressable>
      {caption ? (
        <Text style={[s.caption, mine && { color: '#fff' }]}>{caption}</Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  frame:       { borderRadius: 14, overflow: 'hidden', backgroundColor: colors.ink100 },
  image:       { width: '100%', height: '100%' },
  placeholder: { backgroundColor: colors.primaryTint },
  caption:     { fontSize: 15, color: colors.ink, marginTop: 6, lineHeight: 21 },
});
