// Phase 23 — attachment bottom sheet (Chat → Attach).
//
// All attachment tiles use the same selection and preview flow.

import { useRef } from 'react';
import { Platform, Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme';
import { ATTACHMENT_OPTIONS, AttachmentKey } from '../../media/mediaValidation';

export function AttachmentSheet({
  visible, onClose, onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (key: AttachmentKey) => void;
}) {
  const { t } = useTranslation();
  const selected = useRef<AttachmentKey | null>(null);
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={() => {const key=selected.current;selected.current=null;if(key) onSelect(key);}}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={[s.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
          <View style={s.grabber} />
          <Text style={s.title}>{t('media.attach')}</Text>
          <View style={s.grid}>
            {ATTACHMENT_OPTIONS.map((opt) => (
              <Pressable
                key={opt.key}
                style={s.tile}
                disabled={!opt.enabled}
                onPress={() => { if (opt.enabled) { if (Platform.OS === 'ios') selected.current=opt.key; onClose(); if(Platform.OS !== 'ios') onSelect(opt.key); } }}
                accessibilityRole="button"
                accessibilityState={{ disabled: !opt.enabled }}
                accessibilityLabel={t(opt.labelKey)}
              >
                <View style={[s.iconWrap, !opt.enabled && s.iconWrapDisabled]}>
                  <Ionicons
                    name={opt.icon as any}
                    size={24}
                    color={opt.enabled ? colors.surface : colors.ink400}
                  />
                </View>
                <Text style={[s.label, !opt.enabled && s.labelDisabled]} numberOfLines={1}>
                  {t(opt.labelKey)}
                </Text>
                {!opt.enabled ? <Text style={s.soon}>{t('media.comingSoon')}</Text> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,18,32,0.55)', justifyContent: 'flex-end' },
  sheet:    { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 18, paddingTop: 10 },
  grabber:  { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: colors.ink300, marginBottom: 12 },
  title:    { fontSize: 16, fontWeight: '800', color: colors.ink, marginBottom: 14 },
  grid:     { flexDirection: 'row', flexWrap: 'wrap' },
  tile:     { width: '33.333%' , alignItems: 'center', paddingVertical: 12 },
  iconWrap: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, marginBottom: 6 },
  iconWrapDisabled: { backgroundColor: colors.ink100 },
  label:    { fontSize: 12, fontWeight: '600', color: colors.ink },
  labelDisabled: { color: colors.ink400 },
  soon:     { fontSize: 9, color: colors.ink400, marginTop: 1 },
});
