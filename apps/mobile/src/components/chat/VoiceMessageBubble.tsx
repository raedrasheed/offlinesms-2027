// Phase 23 — voice message content (rendered inside MessageBubble).
//
// Play/pause + waveform + duration. Playback is single-instance (audioPlayer);
// tapping play marks the played receipt once. While the binary is still
// uploading (own message) play is disabled and progress is shown.

import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '../../theme';
import type { Message } from '../../lib/conversations';
import { useCachedMediaUri } from '../../hooks/useCachedMediaUri';
import { useTransfer } from '../../hooks/useTransfer';
import { retryDownload } from '../../media/mediaCache';
import { formatDuration } from '../../media/mediaValidation';
import { togglePlay, subscribePlayback } from '../../media/audio/audioPlayer';
import { Waveform } from './Waveform';

export function VoiceMessageBubble({
  message, mine, onPlayed, onRetry,
}: {
  message: Message;
  mine: boolean;
  onPlayed?: () => void;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const media = message.media;
  const uri = useCachedMediaUri(message);
  const transfer = useTransfer(message.id);
  const durationMs = media?.durationMs ?? 0;
  const status = media?.uploadStatus ?? 'uploaded';
  // Upload progress/retry only applies to your own outgoing message.
  const uploading = mine && (status === 'pending' || status === 'uploading');
  const uploadFailed = mine && status === 'failed';
  // Download progress/retry applies to a received voice note being cached.
  const downloading = !mine && transfer?.kind === 'download' && !transfer.failed;
  const downloadFailed = !mine && transfer?.kind === 'download' && transfer.failed;
  const busy = uploading || downloading;
  const livePct = Math.round(((transfer?.progress ?? media?.uploadProgress ?? 0)) * 100);

  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const playedRef = useRef(false);

  useEffect(() => subscribePlayback((st) => {
    if (st.id === message.id) {
      setPlaying(st.playing);
      setPositionMs(st.positionMs);
    } else {
      setPlaying(false);
      setPositionMs(0);
    }
  }), [message.id]);

  // Telegram light theme: the sent bubble is light green, so "mine" uses
  // green accents — white would vanish on the pale bubble.
  const TG_GREEN = '#5FA84E';
  const sub = mine ? TG_GREEN : colors.ink500;
  const progress = durationMs > 0 ? positionMs / durationMs : 0;
  const remaining = playing && positionMs > 0 ? Math.max(0, durationMs - positionMs) : durationMs;

  async function onPress() {
    if (uploadFailed) { onRetry?.(); return; }
    if (downloadFailed) { void retryDownload(message); return; }
    if (!uri || busy) return;
    if (!playedRef.current) { playedRef.current = true; onPlayed?.(); }
    try { await togglePlay(message.id, uri); } catch { /* noop */ }
  }

  const icon = downloadFailed ? 'arrow-down-circle'
    : uploadFailed ? 'arrow-up-circle'
    : playing ? 'pause' : 'play';

  return (
    <View style={s.row}>
      <Pressable
        onPress={onPress}
        disabled={busy}
        style={[s.playBtn, mine ? s.playBtnMine : s.playBtnTheirs]}
        accessibilityRole="button"
        accessibilityLabel={
          uploadFailed ? t('media.retryUpload')
          : downloadFailed ? t('media.retryDownload')
          : t('media.tapToPlay')
        }
      >
        {busy ? (
          <ActivityIndicator size="small" color={mine ? '#fff' : colors.primary} />
        ) : (
          <Ionicons name={icon} size={20} color={mine ? '#fff' : colors.primary} />
        )}
      </Pressable>

      <View style={s.middle}>
        <Waveform
          bars={media?.waveform ?? null}
          progress={progress}
          color={mine ? 'rgba(95,168,78,0.35)' : colors.ink300}
          playedColor={mine ? TG_GREEN : colors.primary}
          height={26}
        />
        <Text style={[s.duration, { color: sub }]}>
          {busy ? `${livePct}%` : formatDuration(remaining)}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row:           { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 200, paddingVertical: 2 },
  playBtn:       { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  playBtnMine:   { backgroundColor: '#5FA84E' },
  playBtnTheirs: { backgroundColor: colors.primaryLight },
  middle:        { flex: 1, gap: 3 },
  duration:      { fontSize: 11, fontWeight: '600' },
});
