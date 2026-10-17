// Phase 23 — image message content (rendered inside MessageBubble).
//
// Shows the picked/uploaded image with a rounded frame, an upload-progress or
// retry overlay while the binary is in flight, and the optional caption. Tapping
// opens the full-screen viewer. Footer (time/ticks) and long-press actions are
// owned by the surrounding MessageBubble.

import { View, Image } from 'react-native';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../lib/conversations';
import { useCachedMediaUri } from '../../hooks/useCachedMediaUri';
import { useTransfer } from '../../hooks/useTransfer';
import { retryDownload } from '../../media/mediaCache';
import { MediaUploadProgress } from './MediaUploadProgress';
import { MediaMessageFrame, mediaFrameStyles as s } from './MediaMessageFrame';
import { validMediaDimensions, type MediaDimensions } from '../../media/mediaDimensions';

export function ImageMessageBubble({
  message, mine, onOpen, onRetry, onLongPress, footer,
}: {
  message: Message;
  mine: boolean;
  onOpen: (uri: string) => void;
  onRetry?: () => void;
  onLongPress?: () => void;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const media = message.media;
  const uri = useCachedMediaUri(message);
  const transfer = useTransfer(message.id);

  const [loaded, setLoaded] = useState<{ uri: string; size: MediaDimensions } | null>(null);
  const dimensions = validMediaDimensions(media?.width, media?.height) || (loaded?.uri === uri ? loaded.size : null);

  const status = media?.uploadStatus ?? 'uploaded';
  // Upload progress/retry only applies to your own outgoing message.
  const uploading = mine && (status === 'pending' || status === 'uploading');
  const uploadFailed = mine && status === 'failed';
  const uploadPct = transfer?.kind === 'upload' ? transfer.progress : (media?.uploadProgress ?? 0);
  // Download progress/retry applies to a received image being cached.
  const downloading = !mine && transfer?.kind === 'download' && !transfer.failed;
  const downloadFailed = !mine && transfer?.kind === 'download' && transfer.failed;
  const busy = uploading || uploadFailed || downloadFailed;

  return (
      <MediaMessageFrame dimensions={dimensions} caption={message.caption} footer={footer}
        onPress={() => uri && !busy && onOpen(uri === media?.thumbnailURL ? media?.downloadURL || uri : uri)}
        onLongPress={onLongPress}
        label={t('media.openImage')}
        overlay={uploading || uploadFailed || downloading || downloadFailed ? <>
        {uploading ? (
          <MediaUploadProgress progress={uploadPct} mode="upload" />
        ) : null}
        {uploadFailed ? (
          <MediaUploadProgress progress={0} failed mode="upload" onRetry={onRetry} />
        ) : null}
        {downloading ? (
          <MediaUploadProgress progress={transfer?.progress ?? 0} mode="download" />
        ) : null}
        {downloadFailed ? (
          <MediaUploadProgress progress={0} failed mode="download" onRetry={() => { void retryDownload(message); }} />
        ) : null}
        </> : null}
      >
        {uri ? (
          <Image source={{ uri }} style={s.content} resizeMode="contain" onLoad={event => {
            const size = validMediaDimensions(event.nativeEvent.source.width, event.nativeEvent.source.height);
            if (size) setLoaded({ uri, size });
          }} />
        ) : (
          <View style={[s.content, s.placeholder]} />
        )}
      </MediaMessageFrame>
  );
}
