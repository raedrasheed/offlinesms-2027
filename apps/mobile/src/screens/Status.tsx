import { View, Text, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { auth } from '../lib/firebase';
import { useTheme } from '../context/ThemeContext';
import { isRTL } from '../i18n';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Status() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const myName = auth.currentUser?.displayName ?? 'You';
  const s = buildStyles(colors, isRTL);

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.h1}>{t('status.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 150 }}>
        <Pressable
          style={s.myRow}
          onPress={() => Alert.alert(t('status.myStatus'), t('status.comingSoon'))}
        >
          <View style={s.myAvatarWrap}>
            <View style={s.av}><Text style={s.avText}>{initials(myName)}</Text></View>
            <View style={s.plusBadge}>
              <Ionicons name="add" size={14} color="#fff" />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{t('status.myStatus')}</Text>
            <Text style={s.sub}>{t('status.tapToAdd')}</Text>
          </View>
        </Pressable>

        <Text style={s.sectionLabel}>{t('status.recentUpdates')}</Text>

        <View style={s.emptyWrap}>
          <View style={s.emptyIcon}>
            <Ionicons name="ellipse-outline" size={28} color={colors.text.disabled} />
          </View>
          <Text style={s.emptyTitle}>{t('status.noUpdatesTitle')}</Text>
          <Text style={s.emptyDesc}>{t('status.noUpdatesDesc')}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function buildStyles(colors: any, rtl: boolean) {
  return StyleSheet.create({
    root:   { flex: 1, backgroundColor: colors.background.app },
    header: { paddingHorizontal: 16, paddingTop: 50, paddingBottom: 14, backgroundColor: colors.background.surface, borderBottomWidth: 1, borderColor: colors.border.subtle },
    h1:     { fontSize: 24, fontWeight: '800', color: colors.text.primary, textAlign: rtl ? 'right' : 'left' },

    myRow:  { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.background.surface, marginTop: 8 },
    myAvatarWrap: { width: 52, height: 52 },
    av:     { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.action.primary, alignItems: 'center', justifyContent: 'center' },
    avText: { color: colors.action.primaryFg, fontWeight: '800', fontSize: 16 },
    plusBadge: { position: 'absolute', bottom: -2, right: rtl ? undefined : -2, left: rtl ? -2 : undefined, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.action.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.background.surface },
    title:  { fontSize: 15, fontWeight: '700', color: colors.text.primary, textAlign: rtl ? 'right' : 'left' },
    sub:    { fontSize: 12, color: colors.text.muted, marginTop: 2, textAlign: rtl ? 'right' : 'left' },

    sectionLabel: { fontSize: 12, fontWeight: '700', color: colors.text.muted, letterSpacing: 0.5, paddingHorizontal: 16, paddingTop: 22, paddingBottom: 8, textTransform: 'uppercase', textAlign: rtl ? 'right' : 'left' },

    emptyWrap:  { alignItems: 'center', paddingTop: 40, paddingHorizontal: 32, gap: 10 },
    emptyIcon:  { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.background.subtle, alignItems: 'center', justifyContent: 'center' },
    emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.text.primary, textAlign: 'center' },
    emptyDesc:  { fontSize: 13, color: colors.text.muted, textAlign: 'center', lineHeight: 19 },
  });
}
