// Phase 23 — simple bar waveform renderer (recorder bars + voice bubble).
//
// Draws normalized 0..1 bars as rounded rectangles. `progress` (0..1) tints the
// already-played portion. Falls back to a flat row when there are no samples.

import { View, StyleSheet } from 'react-native';

const FALLBACK_BARS = 28;

export function Waveform({
  bars, progress = 0, color, playedColor, height = 24, barWidth = 3, gap = 2,
}: {
  bars: number[] | null | undefined;
  progress?: number;
  color: string;
  playedColor?: string;
  height?: number;
  barWidth?: number;
  gap?: number;
}) {
  const data = bars && bars.length > 0 ? bars : new Array(FALLBACK_BARS).fill(0.15);
  const playedIndex = Math.round(Math.max(0, Math.min(1, progress)) * data.length);

  return (
    <View style={[s.row, { height }]}>
      {data.map((v, i) => {
        const h = Math.max(3, Math.round(v * height));
        const played = playedColor && i < playedIndex;
        return (
          <View
            key={i}
            style={{
              width: barWidth,
              height: h,
              marginHorizontal: gap / 2,
              borderRadius: barWidth / 2,
              backgroundColor: played ? playedColor : color,
            }}
          />
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flex: 1 },
});
