// EmojiPicker3D — bottom-sheet grid of the bundled 3D animated emojis.
// Opened from the composer's smiley button; selecting one inserts the plain
// unicode emoji into the draft (a message that is exactly one supported
// emoji renders as a large animated 3D emoji in the bubble).

import { Modal, View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { EMOJI_3D, type Emoji3D } from '../../lib/emoji3d';
import { AnimatedEmoji3D } from './AnimatedEmoji3D';
import { colors } from '../../theme';

export function EmojiPicker3D({
  visible, onClose, onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (emoji: Emoji3D) => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => { /* swallow */ }}>
          <View style={s.handle} />
          <Text style={s.title}>{t('convo.emojiTitle')}</Text>
          <ScrollView style={s.scroll}>
            <View style={s.grid}>
              {EMOJI_3D.map(e => (
                <Pressable
                  key={e.key}
                  style={s.cell}
                  onPress={() => { onSelect(e); onClose(); }}
                  accessibilityRole="button"
                  accessibilityLabel={e.char}
                >
                  <AnimatedEmoji3D emoji={e} size={52} />
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
  sheet:    { backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 28, paddingTop: 8, paddingHorizontal: 12 },
  handle:   { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: colors.ink200, marginBottom: 8 },
  title:    { fontSize: 13, fontWeight: '700', color: colors.ink500, paddingHorizontal: 8, paddingBottom: 10 },
  scroll:   { maxHeight: 380 },
  grid:     { flexDirection: 'row', flexWrap: 'wrap' },
  cell:     { width: '25%', alignItems: 'center', paddingVertical: 12 },
});
