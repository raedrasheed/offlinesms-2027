import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../lib/conversations';
import { useCachedMediaUri } from '../../hooks/useCachedMediaUri';
import { useTransfer } from '../../hooks/useTransfer';
import { retryDownload } from '../../media/mediaCache';
import { MediaUploadProgress } from './MediaUploadProgress';
import { STICKER_SIZE } from './StickerBubble';
import { saveMessageSticker } from '../../lib/saveMessageSticker';
import { useTheme } from '../../context/ThemeContext';

/** Image transport/cache, with the same transparent presentation as a pack sticker. */
export function CustomStickerBubble({ message, uid, mine, onOpen, onLongPress, onRetry }: {
  message: Message; uid: string; mine: boolean; onOpen?: (uri: string) => void; onLongPress?: () => void; onRetry?: () => void;
}) {
  const { t } = useTranslation(), uri = useCachedMediaUri(message), transfer = useTransfer(message.id);
  const { colors } = useTheme();
  const [badUri, setBadUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false), [saved, setSaved] = useState(false);
  const savingRef = useRef(false), generation = useRef(0);
  useEffect(() => {
    generation.current++; setSaving(false); setSaved(false); savingRef.current = false;
    return () => { generation.current++; };
  }, [uid, message.conversationId, message.id]);
  const status = message.media?.uploadStatus ?? 'uploaded';
  const uploading = mine && (status === 'pending' || status === 'uploading');
  const failedUpload = mine && status === 'failed';
  const failedDownload = !mine && (!!transfer?.failed || !!uri && uri === badUri);
  const downloading = !mine && transfer?.kind === 'download' && !transfer.failed;
  async function save() {
    if (savingRef.current || saved || uploading || failedUpload || failedDownload) return;
    const current = generation.current;
    savingRef.current = true; setSaving(true);
    try {
      await saveMessageSticker(uid, message, t('stickers.customSticker'));
      if (current === generation.current) setSaved(true);
    } catch (error: any) {
      if (current === generation.current) Alert.alert(t('stickers.saveError'), t(
        error?.message === 'sticker-library-full' ? 'stickers.libraryFull' : 'stickers.tryAgain'));
    } finally {
      if (current === generation.current) { savingRef.current = false; setSaving(false); }
    }
  }
  return <View style={{ width: STICKER_SIZE, height: STICKER_SIZE, backgroundColor: 'transparent' }} testID="custom-sticker-bubble">
    <Pressable style={{ flex: 1, backgroundColor: 'transparent' }} onLongPress={onLongPress} delayLongPress={300} accessibilityRole="imagebutton"
      accessibilityLabel={t('stickers.customSticker')} onPress={() => { if (uri && !uploading && !failedUpload && !failedDownload) onOpen?.(uri); }}>
      {uri ? <Image source={{ uri }} resizeMode="contain" style={{ width: '100%', height: '100%', backgroundColor: 'transparent' }}
        onError={() => setBadUri(uri)} onLoad={() => setBadUri(null)} /> : <ActivityIndicator style={{ flex: 1 }} />}
    </Pressable>
    {Platform.OS !== 'web' && uid && status === 'uploaded' && !message.deletedForEveryone ? <Pressable
      onPress={() => void save()} disabled={saving || saved || failedDownload}
      accessibilityRole="button" accessibilityLabel={t(saved ? 'stickers.savedToLibrary' : 'stickers.saveToLibrary')}
      accessibilityState={{ disabled: saving || saved || failedDownload, busy: saving }}
      style={{ position: 'absolute', right: 0, top: 0, minWidth: 44, minHeight: 44, borderRadius: 22,
        alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background.surface,
        borderWidth: 1, borderColor: colors.border.subtle }}>
      {saving ? <ActivityIndicator color={colors.action.primary} /> : <Ionicons
        name={saved ? 'checkmark' : 'bookmark-outline'} size={21} color={colors.action.primary} />}
    </Pressable> : null}
    {uploading || failedUpload ? <MediaUploadProgress progress={transfer?.kind === 'upload' ? transfer.progress : message.media?.uploadProgress ?? 0}
      failed={failedUpload} onRetry={onRetry} /> : null}
    {downloading || failedDownload ? <MediaUploadProgress progress={transfer?.progress ?? 0} failed={failedDownload} mode="download"
      onRetry={() => { setBadUri(null); void retryDownload(message); }} /> : null}
  </View>;
}
