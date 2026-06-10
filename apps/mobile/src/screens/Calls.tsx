import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { isRTL } from '../i18n';

type Filter = 'all' | 'missed';

export default function Calls() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [filter, setFilter] = useState<Filter>('all');
  const s = buildStyles(colors, isRTL);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all',    label: t('calls.filterAll') },
    { key: 'missed', label: t('calls.filterMissed') },
  ];

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.h1}>{t('calls.title')}</Text>
        <View style={s.chips}>
          {FILTERS.map(f => (
            <Pressable
              key={f.key}
              style={[s.chip, filter === f.key && s.chipActive]}
              onPress={() => setFilter(f.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected: filter === f.key }}
            >
              <Text style={[s.chipText, filter === f.key && s.chipTextActive]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 150 }}>
        <View style={s.emptyWrap}>
          <View style={s.emptyIcon}>
            <Ionicons name="call-outline" size={28} color={colors.text.disabled} />
          </View>
          <Text style={s.emptyTitle}>{t('calls.emptyTitle')}</Text>
          <Text style={s.emptyDesc}>{t('calls.emptyDesc')}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function buildStyles(colors: any, rtl: boolean) {
  return StyleSheet.create({
    root:   { flex: 1, backgroundColor: colors.background.app },
    header: { paddingHorizontal: 16, paddingTop: 50, paddingBottom: 14, backgroundColor: colors.background.surface, borderBottomWidth: 1, borderColor: colors.border.subtle, gap: 12 },
    h1:     { fontSize: 24, fontWeight: '800', color: colors.text.primary, textAlign: rtl ? 'right' : 'left' },
    chips:  { flexDirection: rtl ? 'row-reverse' : 'row', gap: 8 },
    chip:        { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.background.subtle, borderWidth: 1, borderColor: colors.border.default },
    chipActive:  { backgroundColor: colors.action.primary, borderColor: colors.action.primary },
    chipText:    { fontSize: 12, color: colors.text.secondary, fontWeight: '600' },
    chipTextActive: { color: colors.action.primaryFg },

    emptyWrap:  { alignItems: 'center', paddingTop: 56, paddingHorizontal: 32, gap: 10 },
    emptyIcon:  { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.background.subtle, alignItems: 'center', justifyContent: 'center' },
    emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.text.primary, textAlign: 'center' },
    emptyDesc:  { fontSize: 13, color: colors.text.muted, textAlign: 'center', lineHeight: 19 },
  });
}
