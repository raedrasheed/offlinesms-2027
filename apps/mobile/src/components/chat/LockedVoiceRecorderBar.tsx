// Phase 23 — locked recording bar (hands-free). Trash to discard, send to upload.

import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '../../theme';
import { formatDuration } from '../../media/mediaValidation';
import { Waveform } from './Waveform';

export function LockedVoiceRecorderBar({
  elapsedMs, bars, onTrash, onSend,
}: {
  elapsedMs: number;
  bars: number[];
  onTrash: () => void;
  onSend: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={s.wrap}>
      <View style={s.bar}>
        <Pressable onPress={onTrash} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.delete')}>
          <Ionicons name="trash-outline" size={22} color={colors.err} />
        </Pressable>
        <View style={s.dot} />
        <Text style={s.timer}>{formatDuration(elapsedMs)}</Text>
        <View style={s.wave}>
          <Waveform bars={bars} color={colors.primary} height={22} />
        </View>
        <Pressable onPress={onSend} style={s.send} accessibilityRole="button" accessibilityLabel={t('common.send')}>
          <Ionicons name="send" size={18} color="#fff" />
        </Pressable>
      </View>
      <Text style={s.lockedLabel}>
        <Ionicons name="lock-closed" size={11} color={colors.ink500} /> {t('media.recordingLocked')}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap:        { flex: 1, gap: 4 },
  bar:         { flexDirection: 'row', alignItems: 'center', gap: 10, height: 44, paddingHorizontal: 12, backgroundColor: colors.surface, borderRadius: 22 },
  dot:         { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.err },
  timer:       { fontSize: 13, fontWeight: '700', color: colors.ink, minWidth: 40 },
  wave:        { flex: 1, height: 22 },
  send:        { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  lockedLabel: { fontSize: 11, color: colors.ink500, textAlign: 'center' },
});
