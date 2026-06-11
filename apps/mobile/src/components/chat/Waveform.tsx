// Phase 23 — simple bar waveform renderer (recorder bars + voice bubble).
//
// Draws normalized 0..1 bars as rounded rectangles. `progress` (0..1) tints the
// already-played portion. Falls back to a flat row when there are no samples.
//
// The row measures itself and RESAMPLES the data to the number of bars that
// actually fit, so a long recording (live recorder bars grow unbounded) or a
// dense stored waveform can never spill outside the bubble. overflow:hidden
// clips as a belt-and-braces guard.

import { useState } from 'react';
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { resampleWaveform } from '../../lib/waveform';

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
  const [width, setWidth] = useState(0);
  const data = bars && bars.length > 0 ? bars : new Array(FALLBACK_BARS).fill(0.15);

  // How many bars fit in the measured width; render nothing until the first
  // layout pass so an unmeasured row never paints an overflowing frame.
  const slot = barWidth + gap;
  const fit = Math.max(1, Math.floor(width / slot));
  const shown = width > 0 ? resampleWaveform(data, Math.min(fit, data.length)) : [];
  const playedIndex = Math.round(Math.max(0, Math.min(1, progress)) * shown.length);

  function onLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width);
  }

  return (
    <View style={[s.row, { height }]} onLayout={onLayout}>
      {shown.map((v, i) => {
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
  row: { flexDirection: 'row', alignItems: 'center', flex: 1, overflow: 'hidden' },
});
