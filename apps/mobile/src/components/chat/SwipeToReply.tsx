// Swipe-to-reply wrapper (WhatsApp/Telegram style).
//
// Wraps a message row; dragging it horizontally to the right past a threshold
// fires `onReply`. A reply glyph fades/scales in on the leading edge while
// dragging and the row springs back on release. Works for incoming and outgoing
// bubbles alike.
//
// Built on Animated + PanResponder (same primitives the composer's mic gesture
// uses) so it needs no GestureHandlerRootView and composes with the existing
// FlatList + long-press. The pan responder only claims clearly-horizontal drags
// (|dx| dominates |dy|), so vertical list scrolling and the bubble long-press
// are never stolen.

import { ReactNode, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '../../theme';

const THRESHOLD = 56;   // px of pull to commit a reply
const MAX_PULL   = 84;  // clamp so the row can't be dragged across the screen

export function SwipeToReply({
  enabled = true,
  onReply,
  children,
}: {
  enabled?: boolean;
  onReply: () => void;
  children: ReactNode;
}) {
  // JS-driven value (we setValue during the drag), so every animation on it must
  // use useNativeDriver:false to stay on the same driver.
  const translateX = useRef(new Animated.Value(0)).current;
  const armedRef = useRef(false);

  const pan = useRef(
    PanResponder.create({
      // Claim only a deliberate rightward, horizontal drag — leaves vertical
      // scroll and taps/long-press to the children.
      onMoveShouldSetPanResponder: (_e, g) =>
        enabled && g.dx > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderGrant: () => { armedRef.current = false; },
      onPanResponderMove: (_e, g) => {
        const x = Math.max(0, Math.min(MAX_PULL, g.dx));
        translateX.setValue(x);
        if (!armedRef.current && x >= THRESHOLD) {
          armedRef.current = true;
          try { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch { /* best-effort */ }
        } else if (armedRef.current && x < THRESHOLD) {
          armedRef.current = false;
        }
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dx >= THRESHOLD) onReply();
        Animated.spring(translateX, { toValue: 0, useNativeDriver: false, friction: 7, tension: 120 }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: false, friction: 7, tension: 120 }).start();
      },
    }),
  ).current;

  const iconOpacity = translateX.interpolate({ inputRange: [0, THRESHOLD], outputRange: [0, 1], extrapolate: 'clamp' });
  const iconScale   = translateX.interpolate({ inputRange: [0, THRESHOLD], outputRange: [0.4, 1], extrapolate: 'clamp' });

  return (
    <View>
      <Animated.View
        pointerEvents="none"
        style={[s.iconWrap, { opacity: iconOpacity, transform: [{ scale: iconScale }] }]}
      >
        <View style={s.iconCircle}>
          <Ionicons name="arrow-undo" size={18} color={colors.primary} />
        </View>
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX }] }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  iconWrap:   { position: 'absolute', left: 14, top: 0, bottom: 0, justifyContent: 'center' },
  iconCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
});
