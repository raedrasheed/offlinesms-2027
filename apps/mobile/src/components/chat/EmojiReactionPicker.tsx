// Reactions share the searchable, virtualized composer catalog.
// Keep the sheet unmounted while closed: every message owns a picker.
import { Modal, View, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { EmojiPanel } from './EmojiPanel';

interface Props {
  visible: boolean;
  uid: string;
  onClose: () => void;
  onSelect: (emoji: string) => void;
}

export function EmojiReactionPicker(props: Props) {
  if (!props.visible) return null;
  return <ReactionSheet {...props} />;
}

function ReactionSheet({ uid, onClose, onSelect }: Props) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={[s.sheet, { height: height * 0.65, paddingBottom: Math.max(insets.bottom, 12), backgroundColor: colors.background.surface }]} onPress={() => { /* contain backdrop presses */ }}>
          <View style={[s.handle, { backgroundColor: colors.border.subtle }]} />
          <EmojiPanel uid={uid} onPick={onSelect} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  handle: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginVertical: 8 },
});

