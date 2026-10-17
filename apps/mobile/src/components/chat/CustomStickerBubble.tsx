import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../lib/conversations';
import { useCachedMediaUri } from '../../hooks/useCachedMediaUri';
import { useTransfer } from '../../hooks/useTransfer';
import { retryDownload } from '../../media/mediaCache';
import { MediaUploadProgress } from './MediaUploadProgress';
import { STICKER_SIZE } from './StickerBubble';

/** Image transport/cache, with the same transparent presentation as a pack sticker. */
export function CustomStickerBubble({ message, mine, onOpen, onLongPress, onRetry }: {
  message: Message; mine: boolean; onOpen?: (uri: string) => void; onLongPress?: () => void; onRetry?: () => void;
}) {
  const { t } = useTranslation(), uri = useCachedMediaUri(message), transfer = useTransfer(message.id);
  const [badUri, setBadUri] = useState<string | null>(null);
  const status = message.media?.uploadStatus ?? 'uploaded';
  const uploading = mine && (status === 'pending' || status === 'uploading');
  const failedUpload = mine && status === 'failed';
  const failedDownload = !mine && (!!transfer?.failed || !!uri && uri === badUri);
  const downloading = !mine && transfer?.kind === 'download' && !transfer.failed;
  return <View style={{ width: STICKER_SIZE, height: STICKER_SIZE }} testID="custom-sticker-bubble">
    <Pressable style={{ flex: 1 }} onLongPress={onLongPress} delayLongPress={300} accessibilityRole="imagebutton"
      accessibilityLabel={t('stickers.customSticker')} onPress={() => { if (uri && !uploading && !failedUpload && !failedDownload) onOpen?.(uri); }}>
      {uri ? <Image source={{ uri }} resizeMode="contain" style={{ width: '100%', height: '100%' }}
        onError={() => setBadUri(uri)} onLoad={() => setBadUri(null)} /> : <ActivityIndicator style={{ flex: 1 }} />}
    </Pressable>
    {uploading || failedUpload ? <MediaUploadProgress progress={transfer?.kind === 'upload' ? transfer.progress : message.media?.uploadProgress ?? 0}
      failed={failedUpload} onRetry={onRetry} /> : null}
    {downloading || failedDownload ? <MediaUploadProgress progress={transfer?.progress ?? 0} failed={failedDownload} mode="download"
      onRetry={() => { setBadUri(null); void retryDownload(message); }} /> : null}
  </View>;
}
