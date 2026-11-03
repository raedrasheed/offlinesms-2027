import type { ReactNode } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useClipsCopy } from '../../lib/clipsCopy';

export default function ClipSheet({ visible, title, onClose, children }: {
  visible: boolean; title: string; onClose: () => void; children: ReactNode;
}) {
  const inset = useSafeAreaInsets();
  const { c, rtl } = useClipsCopy();
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel={c('Close', 'إغلاق')} />
      <View style={[s.sheet, { paddingBottom: Math.max(inset.bottom, 14) }]}>
        <View style={s.handle} />
        <View style={[s.header, rtl && { flexDirection: 'row-reverse' }]}>
          <Text style={s.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel={c('Close', 'إغلاق')}><Ionicons name="close" size={24} color="#182330" /></Pressable>
        </View>
        {children}
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  scrim: { flex: 1, minHeight: 35 },
  sheet: { maxHeight: '91%', minHeight: 220, backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18 },
  handle: { width: 42, height: 4, borderRadius: 3, backgroundColor: '#CDD5DD', alignSelf: 'center', marginTop: 10, marginBottom: 17 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 17 },
  title: { flex: 1, fontSize: 18, fontWeight: '800', textAlign: 'center', color: '#182330' },
});
