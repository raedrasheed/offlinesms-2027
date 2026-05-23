// Mobile support ticket screen.
// Lets authenticated users create a new support ticket or view their existing ones.
// Writes to the 'tickets' collection matching Firestore rules (createdBy = uid, no assignedTo).

import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView,
  ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { auth } from '../lib/firebase';
import { createSupportTicket, subscribeMyTickets, type TicketCategory, type SupportTicket } from '../lib/support';
import { useTheme } from '../context/ThemeContext';
import { isRTL } from '../i18n';
import { radius } from '../theme';

type CategoryDef = { labelKey: string; value: TicketCategory };

const CATEGORIES: CategoryDef[] = [
  { labelKey: 'support.categories.billing',   value: 'billing' },
  { labelKey: 'support.categories.technical', value: 'technical' },
  { labelKey: 'support.categories.account',   value: 'account' },
  { labelKey: 'support.categories.other',     value: 'other' },
];

const STATUS_COLOR: Record<string, string> = {
  open:     '#2563EB',
  pending:  '#D97706',
  resolved: '#059669',
  closed:   '#6B7280',
};

export default function SupportTicket({ navigation }: any) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const uid = auth.currentUser?.uid;
  const [tab, setTab]           = useState<'new' | 'history'>('new');
  const [subject, setSubject]   = useState('');
  const [description, setDesc]  = useState('');
  const [category, setCategory] = useState<TicketCategory>('other');
  const [busy, setBusy]         = useState(false);
  const [tickets, setTickets]   = useState<SupportTicket[]>([]);

  useEffect(() => {
    if (!uid) return;
    return subscribeMyTickets(uid, setTickets);
  }, [uid]);

  async function submit() {
    if (!uid || busy) return;
    if (!subject.trim()) { Alert.alert(t('support.required'), t('support.requiredSubject')); return; }
    if (!description.trim()) { Alert.alert(t('support.required'), t('support.requiredDetails')); return; }
    setBusy(true);
    try {
      await createSupportTicket({ uid, subject, description, category });
      Alert.alert(t('support.submitted'), t('support.submittedMessage'));
      setSubject('');
      setDesc('');
      setCategory('other');
      setTab('history');
    } catch (e: any) {
      Alert.alert(t('common.retry'), e?.message ?? t('support.submitError'));
    } finally {
      setBusy(false);
    }
  }

  const s = buildStyles(colors, isRTL);

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={s.backBtn}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Text style={s.backText}>{isRTL ? '›' : '‹'}</Text>
        </Pressable>
        <Text style={s.heading}>{t('support.title')}</Text>
      </View>

      <View style={s.tabs}>
        <Pressable
          style={[s.tab, tab === 'new' && s.tabActive]}
          onPress={() => setTab('new')}
          accessibilityRole="tab"
          accessibilityLabel={t('support.newTicket')}
          accessibilityState={{ selected: tab === 'new' }}
        >
          <Text style={[s.tabText, tab === 'new' && s.tabTextActive]}>{t('support.newTicket')}</Text>
        </Pressable>
        <Pressable
          style={[s.tab, tab === 'history' && s.tabActive]}
          onPress={() => setTab('history')}
          accessibilityRole="tab"
          accessibilityLabel={t('support.myTickets')}
          accessibilityState={{ selected: tab === 'history' }}
        >
          <Text style={[s.tabText, tab === 'history' && s.tabTextActive]}>{t('support.myTickets')}</Text>
        </Pressable>
      </View>

      {tab === 'new' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
          <Text style={s.label}>{t('support.category')}</Text>
          <View style={s.categoryRow}>
            {CATEGORIES.map(c => (
              <Pressable
                key={c.value}
                style={[s.chip, category === c.value && s.chipActive]}
                onPress={() => setCategory(c.value)}
                accessibilityRole="radio"
                accessibilityLabel={t(c.labelKey)}
                accessibilityState={{ selected: category === c.value }}
              >
                <Text style={[s.chipText, category === c.value && s.chipTextActive]}>{t(c.labelKey)}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={s.label}>
            {t('support.subject')} <Text style={s.required}>*</Text>
          </Text>
          <TextInput
            style={s.input}
            value={subject}
            onChangeText={setSubject}
            placeholder={t('support.subjectPlaceholder')}
            placeholderTextColor={colors.text.disabled}
            maxLength={120}
            returnKeyType="next"
            textAlign={isRTL ? 'right' : 'left'}
            accessibilityLabel={t('support.subject')}
          />

          <Text style={s.label}>
            {t('support.details')} <Text style={s.required}>*</Text>
          </Text>
          <TextInput
            style={[s.input, s.textarea]}
            value={description}
            onChangeText={setDesc}
            placeholder={t('support.detailsPlaceholder')}
            placeholderTextColor={colors.text.disabled}
            multiline
            numberOfLines={5}
            maxLength={2000}
            textAlignVertical="top"
            textAlign={isRTL ? 'right' : 'left'}
            accessibilityLabel={t('support.details')}
          />

          <Pressable
            style={[s.btn, busy && s.btnDisabled]}
            onPress={submit}
            disabled={busy}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={t('support.submit')}
            accessibilityState={{ disabled: busy, busy }}
          >
            {busy
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.btnText}>{t('support.submit')}</Text>}
          </Pressable>
        </ScrollView>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.historyList}>
          {tickets.length === 0 ? (
            <Text style={s.empty}>{t('support.empty')}</Text>
          ) : (
            tickets.map(tk => (
              <View key={tk.id} style={s.ticketCard}>
                <View style={s.ticketRow}>
                  <Text style={s.ticketSubject} numberOfLines={1}>{tk.subject}</Text>
                  <View style={[s.badge, { backgroundColor: STATUS_COLOR[tk.status] ?? '#6B7280' }]}>
                    <Text style={s.badgeText}>{tk.status}</Text>
                  </View>
                </View>
                <Text style={s.ticketMeta}>{tk.category} · {tk.createdAt}</Text>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

function buildStyles(colors: any, rtl: boolean) {
  return StyleSheet.create({
    root:          { flex: 1, backgroundColor: colors.background.app },
    header:        { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', padding: 16, gap: 12, backgroundColor: colors.background.surface, borderBottomWidth: 1, borderBottomColor: colors.border.subtle },
    backBtn:       { paddingRight: rtl ? 0 : 8, paddingLeft: rtl ? 8 : 0 },
    backText:      { fontSize: 24, color: colors.action.primary, fontWeight: '600' },
    heading:       { fontSize: 18, fontWeight: '800', color: colors.text.primary },
    tabs:          { flexDirection: rtl ? 'row-reverse' : 'row', paddingHorizontal: 16, paddingTop: 12, gap: 8 },
    tab:           { flex: 1, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.background.subtle, alignItems: 'center' },
    tabActive:     { backgroundColor: colors.action.primary },
    tabText:       { fontSize: 13, fontWeight: '700', color: colors.text.muted },
    tabTextActive: { color: '#fff' },
    form:          { padding: 16, gap: 8 },
    label:         { fontSize: 12, fontWeight: '700', color: colors.text.primary, marginTop: 8, textAlign: rtl ? 'right' : 'left' },
    required:      { color: colors.state.error },
    input:         { backgroundColor: colors.background.surface, borderWidth: 1, borderColor: colors.border.default, borderRadius: radius.md, padding: 12, fontSize: 14, color: colors.text.primary },
    textarea:      { height: 120 },
    categoryRow:   { flexDirection: rtl ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
    chip:          { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.background.subtle, borderWidth: 1, borderColor: colors.border.subtle },
    chipActive:    { backgroundColor: colors.action.primary, borderColor: colors.action.primary },
    chipText:      { fontSize: 12, fontWeight: '600', color: colors.text.muted },
    chipTextActive:{ color: '#fff' },
    btn:           { marginTop: 16, backgroundColor: colors.action.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
    btnDisabled:   { opacity: 0.6 },
    btnText:       { color: '#fff', fontWeight: '800', fontSize: 15 },
    historyList:   { padding: 16, gap: 10 },
    ticketCard:    { backgroundColor: colors.background.surface, borderRadius: radius.md, padding: 14, gap: 4, borderWidth: 1, borderColor: colors.border.subtle },
    ticketRow:     { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 8 },
    ticketSubject: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text.primary, textAlign: rtl ? 'right' : 'left' },
    ticketMeta:    { fontSize: 11, color: colors.text.muted, textAlign: rtl ? 'right' : 'left' },
    badge:         { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
    badgeText:     { fontSize: 10, fontWeight: '700', color: '#fff', textTransform: 'uppercase' },
    empty:         { textAlign: 'center', color: colors.text.muted, marginTop: 40, fontSize: 13 },
  });
}
