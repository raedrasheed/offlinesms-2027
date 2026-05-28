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
  const uri = media?.downloadURL || media?.localUri || null;
  const durationMs = media?.durationMs ?? 0;
  const status = media?.uploadStatus ?? 'uploaded';
  // Upload progress/retry only applies to your own outgoing message.
  const uploading = mine && (status === 'pending' || status === 'uploading');
  const failed = mine && status === 'failed';

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

  const fg = mine ? '#fff' : colors.ink;
  const sub = mine ? 'rgba(255,255,255,0.75)' : colors.ink500;
  const progress = durationMs > 0 ? positionMs / durationMs : 0;
  const remaining = playing && positionMs > 0 ? Math.max(0, durationMs - positionMs) : durationMs;

  async function onPress() {
    if (!uri || uploading || failed) return;
    if (!playedRef.current) { playedRef.current = true; onPlayed?.(); }
    try { await togglePlay(message.id, uri); } catch { /* noop */ }
  }

  return (
    <View style={s.row}>
      <Pressable
        onPress={failed ? onRetry : onPress}
        disabled={uploading}
        style={[s.playBtn, mine ? s.playBtnMine : s.playBtnTheirs]}
        accessibilityRole="button"
        accessibilityLabel={failed ? t('media.retryUpload') : t('media.tapToPlay')}
      >
        {uploading ? (
          <ActivityIndicator size="small" color={mine ? '#fff' : colors.primary} />
        ) : (
          <Ionicons
            name={failed ? 'refresh' : playing ? 'pause' : 'play'}
            size={20}
            color={mine ? '#fff' : colors.primary}
          />
        )}
      </Pressable>

      <View style={s.middle}>
        <Waveform
          bars={media?.waveform ?? null}
          progress={progress}
          color={mine ? 'rgba(255,255,255,0.45)' : colors.ink300}
          playedColor={mine ? '#fff' : colors.primary}
          height={26}
        />
        <Text style={[s.duration, { color: sub }]}>
          {uploading ? `${Math.round((media?.uploadProgress ?? 0) * 100)}%` : formatDuration(remaining)}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row:           { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 200, paddingVertical: 2 },
  playBtn:       { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  playBtnMine:   { backgroundColor: 'rgba(255,255,255,0.18)' },
  playBtnTheirs: { backgroundColor: colors.primaryLight },
  middle:        { flex: 1, gap: 3 },
  duration:      { fontSize: 11, fontWeight: '600' },
});
