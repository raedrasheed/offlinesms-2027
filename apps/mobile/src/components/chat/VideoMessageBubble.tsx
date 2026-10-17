import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View, Text, Image, Modal, Pressable, StyleSheet, Alert, useWindowDimensions } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../lib/conversations';
import { ensureCached } from '../../media/mediaCache';
import { fitMediaDimensions, validMediaDimensions, videoDisplayDimensions, type MediaDimensions } from '../../media/mediaDimensions';
import { useTransfer } from '../../hooks/useTransfer';
import { MediaMessageFrame, mediaFrameStyles } from './MediaMessageFrame';
import { MediaUploadProgress } from './MediaUploadProgress';

/** Same card as a photo. A video decoder/download exists only after an explicit tap. */
export function VideoMessageBubble({ message, mine, footer, onRetry, onLongPress }: {
  message: Message;
  mine: boolean;
  footer?: ReactNode;
  onRetry?: () => void;
  onLongPress?: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const transfer = useTransfer(message.id);
  const media = message.media;
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [natural, setNatural] = useState<MediaDimensions | null>(null);
  const opening = useRef(false);
  const shareInFlight = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    opening.current = false;
    setViewerUri(null); setBusy(false); setFailed(false); setNatural(null);
    return () => { generation.current++; };
  }, [message.id, media?.downloadURL, media?.localUri]);

  const dimensions = natural || validMediaDimensions(media?.width, media?.height);
  const status = media?.uploadStatus ?? 'uploaded';
  const uploading = mine && (status === 'pending' || status === 'uploading');
  const uploadFailed = mine && status === 'failed';
  const ready = status === 'uploaded';
  const viewerSize = fitMediaDimensions(dimensions, window.width - insets.left - insets.right,
    window.height - insets.top - insets.bottom - 64);

  async function open() {
    if (opening.current || !ready) return;
    opening.current = true;
    const request = generation.current;
    setBusy(true); setFailed(false);
    try {
      const uri = await ensureCached(message);
      if (request !== generation.current) return;
      if (!uri) throw new Error('download-failed');
      setViewerUri(uri);
    } catch {
      if (request === generation.current) setFailed(true);
    } finally {
      if (request === generation.current) { opening.current = false; setBusy(false); }
    }
  }

  async function share() {
    if (!viewerUri || shareInFlight.current) return;
    shareInFlight.current = true; setSharing(true);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('sharing-unavailable');
      await Sharing.shareAsync(viewerUri, { mimeType: media?.mimeType, dialogTitle: t('attachments.shareSave') });
    } catch { Alert.alert(t('attachments.openError'), t('attachments.retryHint')); }
    finally { shareInFlight.current = false; setSharing(false); }
  }

  return <>
    <MediaMessageFrame dimensions={dimensions} caption={message.caption} footer={footer}
      label={t('media.tapToPlay')} onPress={() => { if (!uploading && !uploadFailed) void open(); }} onLongPress={onLongPress}
      overlay={uploading ? <MediaUploadProgress mode="upload" progress={transfer?.kind === 'upload' ? transfer.progress : media?.uploadProgress ?? 0}/>
        : uploadFailed ? <MediaUploadProgress mode="upload" progress={0} failed onRetry={onRetry}/>
        : busy ? <MediaUploadProgress mode="download" progress={transfer?.kind === 'download' ? transfer.progress : 0}/>
        : failed ? <MediaUploadProgress mode="download" progress={0} failed onRetry={() => { void open(); }}/>
        : <View pointerEvents="none" style={s.playOverlay}>
          <View style={s.play}><Ionicons name={ready ? 'play' : 'time-outline'} size={30} color="#fff"/></View>
          {!ready ? <Text style={s.waiting}>{t('attachments.waitingUpload')}</Text> : null}
        </View>}>
      {media?.thumbnailURL ? <Image source={{ uri: media.thumbnailURL }} style={mediaFrameStyles.content} resizeMode="contain"/>
        : <View style={[mediaFrameStyles.content, mediaFrameStyles.placeholder]}/>}
    </MediaMessageFrame>
    {viewerUri ? <Modal visible animationType="fade" onRequestClose={() => setViewerUri(null)}>
      <View style={[s.viewer, { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]}>
        <View style={s.toolbar}>
          <Pressable style={s.tool} onPress={() => setViewerUri(null)} accessibilityRole="button" accessibilityLabel={t('names.close')}>
            <Ionicons name="close" size={28} color="#fff"/>
          </Pressable>
          <Pressable style={s.tool} disabled={sharing} onPress={() => { void share(); }} accessibilityRole="button" accessibilityLabel={t('attachments.shareSave')}>
            <Ionicons name="share-outline" size={26} color="#fff"/>
          </Pressable>
        </View>
        <View style={s.playerWrap}>
          <Video source={{ uri: viewerUri }} style={viewerSize} useNativeControls resizeMode={ResizeMode.CONTAIN} shouldPlay
            onReadyForDisplay={event => {
              const size = videoDisplayDimensions(event.naturalSize);
              if (size) setNatural(previous => previous?.width === size.width && previous.height === size.height ? previous : size);
            }} onError={() => {
              setViewerUri(null); setFailed(true);
              Alert.alert(t('attachments.openError'), t('attachments.retryHint'));
            }}/>
        </View>
      </View>
    </Modal> : null}
  </>;
}

const s = StyleSheet.create({
  playOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  play: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  waiting: { fontSize: 12, marginTop: 8 },
  viewer: { flex: 1, backgroundColor: '#0A0F1C' },
  toolbar: { height: 64, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12 },
  tool: { padding: 10 },
  playerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
