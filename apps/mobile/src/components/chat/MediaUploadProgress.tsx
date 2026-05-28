// Phase 23 — inline upload progress overlay for a media bubble.
//
// Shows a circular progress ring + percentage while uploading, or a retry
// affordance when the upload failed. Sits centered over the image/voice bubble.

import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

const SIZE = 54;
const STROKE = 4;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

export function MediaUploadProgress({
  progress, failed, onRetry, mode = 'upload',
}: {
  progress: number;       // 0..1
  failed?: boolean;
  onRetry?: () => void;
  mode?: 'upload' | 'download';
}) {
  const { t } = useTranslation();
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);

  if (failed) {
    const label = mode === 'download' ? t('media.retryDownload') : t('media.retryUpload');
    return (
      <View style={s.overlay}>
        <Pressable style={s.failBtn} onPress={onRetry} accessibilityRole="button" accessibilityLabel={label}>
          <Ionicons name={mode === 'download' ? 'arrow-down-circle' : 'arrow-up-circle'} size={22} color="#fff" />
          <Text style={s.failText}>{label}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.overlay} accessibilityLabel={t('media.uploading', { percent: pct })}>
      <View style={s.ringWrap}>
        <Svg width={SIZE} height={SIZE}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke="rgba(255,255,255,0.35)" strokeWidth={STROKE} fill="none" />
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            stroke="#fff"
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - Math.max(0, Math.min(1, progress)))}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>
        <Text style={s.pct}>{pct}%</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  overlay:  { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,18,32,0.25)', borderRadius: 14 },
  ringWrap: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  pct:      { position: 'absolute', fontSize: 12, fontWeight: '800', color: '#fff' },
  failBtn:  { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  failText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
