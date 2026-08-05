// Full emoji reaction picker — a bottom sheet of categorized unicode emojis.
//
// Opened from the "+" on the message action sheet's quick-reaction strip.
// Selecting any emoji calls onSelect(emoji), which flows through the SAME
// reaction path as the quick reactions (one-per-user toggle/replace, offline
// queue, Firestore sync). Dependency-free (curated list), so it adds no native
// module and works offline.

import { useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { colors, radius } from '../../theme';
import { EMOJI_CATEGORIES } from '../../lib/emojiList';

export function EmojiReactionPicker({
  visible, onClose, onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
}) {
  const [cat, setCat] = useState(EMOJI_CATEGORIES[0].key);
  const active = EMOJI_CATEGORIES.find(c => c.key === cat) ?? EMOJI_CATEGORIES[0];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => { /* swallow */ }}>
          <View style={s.handle} />

          {/* Category tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
            {EMOJI_CATEGORIES.map(c => (
              <Pressable
                key={c.key}
                onPress={() => setCat(c.key)}
                style={[s.tab, c.key === cat && s.tabActive]}
                accessibilityRole="button"
                accessibilityLabel={c.label}
              >
                <Text style={s.tabIcon}>{c.icon}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled">
            <Text style={s.section}>{active.label}</Text>
            <View style={s.grid}>
              {active.emojis.map((e, i) => (
                <Pressable
                  key={`${e}-${i}`}
                  style={s.cell}
                  onPress={() => { onSelect(e); onClose(); }}
                  accessibilityRole="button"
                  accessibilityLabel={e}
                >
                  <Text style={s.emoji}>{e}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet:    { backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 28, paddingTop: 8, paddingHorizontal: 12, maxHeight: '70%' },
  handle:   { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: colors.ink200, marginBottom: 8 },
  tabs:     { gap: 6, paddingVertical: 4, paddingHorizontal: 2 },
  tab:      { width: 40, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  tabActive:{ backgroundColor: colors.primaryLight },
  tabIcon:  { fontSize: 20 },
  scroll:   { marginTop: 6 },
  section:  { fontSize: 12, fontWeight: '700', color: colors.ink500, paddingHorizontal: 6, paddingVertical: 8, letterSpacing: 0.4 },
  grid:     { flexDirection: 'row', flexWrap: 'wrap' },
  cell:     { width: `${100 / 8}%`, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  emoji:    { fontSize: 28 },
});
