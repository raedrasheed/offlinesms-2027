// RequestPoints — informational screen (no purchase / payment).
//
// The mobile app does NOT sell points. Points are assigned by an organization
// or an OfflineSMS admin. This screen replaces the former purchase flow: it
// explains how points are obtained and offers no price, package, currency,
// checkout, or payment of any kind.

import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { isRTL } from '../i18n';
import { radius } from '../theme';

export default function RequestPoints({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = buildStyles(colors, isRTL);

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 24 }]}
    >
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          accessible
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Ionicons name={isRTL ? 'chevron-forward' : 'chevron-back'} size={24} color={colors.text.primary} />
        </Pressable>
        <Text style={s.title}>{t('points.requestTitle')}</Text>
      </View>

      <View style={s.iconBubble}>
        <Ionicons name="information-circle-outline" size={36} color={colors.action.primary} />
      </View>

      <Text style={s.heading}>{t('points.requestHeading')}</Text>
      <Text style={s.body}>{t('points.requestExplainer')}</Text>

      <View style={s.noteCard}>
        <Ionicons name="business-outline" size={18} color={colors.text.muted} />
        <Text style={s.noteText}>{t('points.requestAdminNote')}</Text>
      </View>

      <Pressable
        style={s.primaryBtn}
        onPress={() => navigation.goBack()}
        accessible
        accessibilityRole="button"
        accessibilityLabel={t('common.gotIt')}
      >
        <Text style={s.primaryBtnText}>{t('common.gotIt')}</Text>
      </Pressable>
    </ScrollView>
  );
}

function buildStyles(colors: any, rtl: boolean) {
  return StyleSheet.create({
    root:    { flex: 1, backgroundColor: colors.background.app },
    content: { paddingHorizontal: 20 },
    header:  { paddingBottom: 12, flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 12 },
    title:   { fontSize: 16, fontWeight: '800', color: colors.text.primary },
    iconBubble: { alignSelf: 'center', width: 72, height: 72, borderRadius: 36, backgroundColor: colors.action.subtle, alignItems: 'center', justifyContent: 'center', marginTop: 24, marginBottom: 16 },
    heading: { fontSize: 20, fontWeight: '800', color: colors.text.primary, textAlign: 'center' },
    body:    { fontSize: 14, color: colors.text.secondary, lineHeight: 21, textAlign: 'center', marginTop: 10 },
    noteCard: { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 10, marginTop: 22, padding: 14, backgroundColor: colors.background.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.subtle },
    noteText: { flex: 1, fontSize: 13, color: colors.text.secondary, lineHeight: 19, textAlign: rtl ? 'right' : 'left' },
    primaryBtn: { marginTop: 28, padding: 16, borderRadius: radius.md, backgroundColor: colors.action.primary, alignItems: 'center' },
    primaryBtnText: { color: colors.action.primaryFg, fontWeight: '800', fontSize: 15 },
  });
}
