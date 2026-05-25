// ChatActionSheet — long-press message menu matching the design guide.
//
// Dimmed backdrop, a reaction strip, a compact preview of the selected
// message, and a rounded white action menu. The caller supplies the action
// rows so permission logic stays in MessageBubble; this component is purely
// presentational.

import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
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
  visible, onClose, mine, previewText, reactions, onReact, actions,
}: {
  visible:     boolean;
  onClose:     () => void;
  mine:        boolean;
  previewText: string;
  reactions:   readonly string[];
  onReact:     (emoji: string) => void;
  actions:     SheetAction[];
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.center} onPress={() => {}}>
          {reactions.length > 0 ? (
            <View style={[s.reactionStrip, mine ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }]}>
              {reactions.map(e => (
                <Pressable key={e} style={s.reactionItem} onPress={() => onReact(e)}>
                  <Text style={s.reactionEmoji}>{e}</Text>
                </Pressable>
              ))}
              <View style={s.reactionPlus}>
                <Ionicons name="add" size={20} color={colors.ink500} />
              </View>
            </View>
          ) : null}

          <View style={[s.previewBubble, mine ? s.previewMine : s.previewOther]}>
            <Text style={[s.previewText, mine && { color: '#fff' }]} numberOfLines={4}>
              {previewText}
            </Text>
          </View>
        </Pressable>

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
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop:     { flex: 1, backgroundColor: 'rgba(15,18,32,0.55)', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 120, paddingBottom: 28 },
  center:       { gap: 12 },
  reactionStrip:{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 6, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  reactionItem: { paddingHorizontal: 6, paddingVertical: 2 },
  reactionEmoji:{ fontSize: 24 },
  reactionPlus: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
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
