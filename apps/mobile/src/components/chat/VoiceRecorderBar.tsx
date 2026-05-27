// Phase 23 — active (unlocked) recording bar shown while holding the mic.
//
// Red dot + elapsed timer + live waveform + "Slide to cancel" hint and a lock
// affordance. The gesture itself (hold / slide-left / swipe-up) lives in the
// composer; this is presentational. `cancelArmed` tints the hint when the user
// has slid far enough left to cancel on release.

import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '../../theme';
import { formatDuration } from '../../media/mediaValidation';
import { Waveform } from './Waveform';

export function VoiceRecorderBar({
  elapsedMs, bars, cancelArmed,
}: {
  elapsedMs: number;
  bars: number[];
  cancelArmed: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={s.bar} accessibilityLabel={t('media.slideToCancel')}>
      <View style={s.dot} />
      <Text style={s.timer}>{formatDuration(elapsedMs)}</Text>
      <View style={s.wave}>
        <Waveform bars={bars} color={colors.ink300} height={22} />
      </View>
      <Text style={[s.hint, cancelArmed && s.hintArmed]} numberOfLines={1}>
        {cancelArmed ? t('media.slideToCancel') : `‹ ${t('media.slideToCancel')}`}
      </Text>
      <Ionicons name="lock-open-outline" size={16} color={colors.ink400} style={s.lock} />
    </View>
  );
}

const s = StyleSheet.create({
  bar:      { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 12, backgroundColor: colors.surface, borderRadius: 22 },
  dot:      { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.err },
  timer:    { fontSize: 13, fontWeight: '700', color: colors.ink, minWidth: 40 },
  wave:     { flex: 1, height: 22 },
  hint:     { fontSize: 12, color: colors.ink500 },
  hintArmed:{ color: colors.err, fontWeight: '700' },
  lock:     { marginLeft: 2 },
});
