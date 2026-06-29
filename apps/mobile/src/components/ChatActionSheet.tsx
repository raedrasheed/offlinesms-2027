// ChatActionSheet — long-press message menu matching the design guide.
//
// Dimmed backdrop, a compact reaction strip that springs in, a preview of the
// selected message, and a rounded white action menu that pops up. The caller
// supplies the action rows so permission logic stays in MessageBubble.

import { useEffect, useRef } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';

export type SheetAction = {
  key:          string;
  label:        string;
  icon:         keyof typeof Ionicons.glyphMap;
  onPress:      () => void;
  destructive?: boolean;
  highlighted?: boolean;
};

export function ChatActionSheet({
  visible, onClose, mine, previewText, reactions, onReact, onMore, actions,
}: {
  visible:     boolean;
  onClose:     () => void;
  mine:        boolean;
  previewText: string;
  reactions:   readonly string[];
  onReact:     (emoji: string) => void;
  /** Open the full emoji reaction picker ("+" on the quick-reaction strip). */
  onMore?:     () => void;
  actions:     SheetAction[];
}) {
  // "Breathe" animation — reactions + preview spring/scale in, menu rises.
  const scale   = useRef(new Animated.Value(0.8)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const menuY   = useRef(new Animated.Value(28)).current;

  useEffect(() => {
    if (!visible) return;
    scale.setValue(0.8); opacity.setValue(0); menuY.setValue(28);
    Animated.parallel([
      Animated.spring(scale,   { toValue: 1, friction: 6, tension: 140, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.spring(menuY,   { toValue: 0, friction: 9, tension: 120, useNativeDriver: true }),
    ]).start();
  }, [visible, scale, opacity, menuY]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Animated.View style={[s.top, { opacity, transform: [{ scale }] }]}>
          {reactions.length > 0 ? (
            <View style={[s.reactionStrip, mine ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }]}>
              {reactions.map(e => (
                <Pressable
                  key={e}
                  hitSlop={4}
                  style={({ pressed }) => [s.reactionItem, pressed && { transform: [{ scale: 1.35 }] }]}
                  onPress={() => onReact(e)}
                >
                  <Text style={s.reactionEmoji}>{e}</Text>
                </Pressable>
              ))}
              {onMore ? (
                <Pressable
                  style={({ pressed }) => [s.reactionPlus, pressed && { transform: [{ scale: 1.1 }] }]}
                  onPress={onMore}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="More emojis"
                >
                  <Ionicons name="add" size={18} color={colors.ink700} />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <View style={[s.previewBubble, mine ? s.previewMine : s.previewOther]}>
            <Text style={[s.previewText, mine && { color: '#fff' }]} numberOfLines={4}>
              {previewText}
            </Text>
          </View>
        </Animated.View>

        <Animated.View style={{ opacity, transform: [{ translateY: menuY }] }}>
          <Pressable style={s.menu} onPress={() => {}}>
            {actions.map((a, i) => (
              <Pressable
                key={a.key}
                style={[s.menuRow, a.highlighted && s.menuRowHighlight, i > 0 && s.menuDivider]}
                onPress={a.onPress}
              >
                <Ionicons
                  name={a.icon}
                  size={20}
                  color={a.destructive ? colors.err : a.highlighted ? colors.primary : colors.ink700}
                />
                <Text
                  style={[
                    s.menuLabel,
                    a.destructive && { color: colors.err },
                    a.highlighted && { color: colors.primary, fontWeight: '700' },
                  ]}
                >
                  {a.label}
                </Text>
                {a.highlighted ? <Ionicons name="chevron-forward" size={18} color={colors.primary} /> : null}
              </Pressable>
            ))}
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop:     { flex: 1, backgroundColor: 'rgba(15,18,32,0.55)', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 120, paddingBottom: 28 },
  top:          { gap: 12 },
  reactionStrip:{ flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#fff', borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 5, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  reactionItem: { paddingHorizontal: 4, paddingVertical: 2 },
  reactionEmoji:{ fontSize: 22 },
  reactionPlus: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
  previewBubble:{ maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  previewMine:  { alignSelf: 'flex-end', backgroundColor: '#1E88E5', borderBottomRightRadius: 8 },
  previewOther: { alignSelf: 'flex-start', backgroundColor: '#fff', borderBottomLeftRadius: 8 },
  previewText:  { fontSize: 15, color: colors.ink, lineHeight: 21 },
  menu:         { backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  menuRow:      { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 15, paddingHorizontal: 18 },
  menuDivider:  { borderTopWidth: 1, borderColor: colors.ink100 },
  menuRowHighlight: { backgroundColor: colors.primaryLight },
  menuLabel:    { flex: 1, fontSize: 15, fontWeight: '600', color: colors.ink },
});
