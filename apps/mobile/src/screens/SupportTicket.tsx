// Mobile support ticket screen.
// Lets authenticated users create a new support ticket or view their existing ones.
// Writes to the 'tickets' collection matching Firestore rules (createdBy = uid, no assignedTo).

import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView,
  ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import { auth } from '../lib/firebase';
import { createSupportTicket, subscribeMyTickets, type TicketCategory, type SupportTicket } from '../lib/support';
import { colors, radius } from '../theme';

const CATEGORIES: { label: string; value: TicketCategory }[] = [
  { label: 'Billing',   value: 'billing' },
  { label: 'Technical', value: 'technical' },
  { label: 'Account',   value: 'account' },
  { label: 'Other',     value: 'other' },
];

const STATUS_COLORS: Record<string, string> = {
  open:     colors.primary ?? '#2563EB',
  pending:  '#D97706',
  resolved: '#059669',
  closed:   '#6B7280',
};

export default function SupportTicket({ navigation }: any) {
  const uid = auth.currentUser?.uid;
  const [tab, setTab]             = useState<'new' | 'history'>('new');
  const [subject, setSubject]     = useState('');
  const [description, setDesc]    = useState('');
  const [category, setCategory]   = useState<TicketCategory>('other');
  const [busy, setBusy]           = useState(false);
  const [tickets, setTickets]     = useState<SupportTicket[]>([]);

  useEffect(() => {
    if (!uid) return;
    return subscribeMyTickets(uid, setTickets);
  }, [uid]);

  async function submit() {
    if (!uid || busy) return;
    if (!subject.trim()) { Alert.alert('Required', 'Please enter a subject.'); return; }
    if (!description.trim()) { Alert.alert('Required', 'Please describe your issue.'); return; }
    setBusy(true);
    try {
      await createSupportTicket({ uid, subject, description, category });
      Alert.alert('Submitted', 'Your ticket has been received. We'll get back to you soon.');
      setSubject('');
      setDesc('');
      setCategory('other');
      setTab('history');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not submit ticket. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} style={s.back}>
          <Text style={s.backText}>‹ Back</Text>
        </Pressable>
        <Text style={s.heading}>Help & Support</Text>
      </View>

      {/* Tabs */}
      <View style={s.tabs}>
        <Pressable style={[s.tab, tab === 'new' && s.tabActive]} onPress={() => setTab('new')}>
          <Text style={[s.tabText, tab === 'new' && s.tabTextActive]}>New ticket</Text>
        </Pressable>
        <Pressable style={[s.tab, tab === 'history' && s.tabActive]} onPress={() => setTab('history')}>
          <Text style={[s.tabText, tab === 'history' && s.tabTextActive]}>My tickets</Text>
        </Pressable>
      </View>

      {tab === 'new' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
          <Text style={s.label}>Category</Text>
          <View style={s.categoryRow}>
            {CATEGORIES.map(c => (
              <Pressable
                key={c.value}
                style={[s.chip, category === c.value && s.chipActive]}
                onPress={() => setCategory(c.value)}
              >
                <Text style={[s.chipText, category === c.value && s.chipTextActive]}>{c.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={s.label}>Subject <Text style={s.required}>*</Text></Text>
          <TextInput
            style={s.input}
            value={subject}
            onChangeText={setSubject}
            placeholder="Brief description of your issue"
            placeholderTextColor={colors.ink400}
            maxLength={120}
            returnKeyType="next"
          />

          <Text style={s.label}>Details <Text style={s.required}>*</Text></Text>
          <TextInput
            style={[s.input, s.textarea]}
            value={description}
            onChangeText={setDesc}
            placeholder="Please describe your issue in detail"
            placeholderTextColor={colors.ink400}
            multiline
            numberOfLines={5}
            maxLength={2000}
            textAlignVertical="top"
          />

          <Pressable style={[s.btn, busy && s.btnDisabled]} onPress={submit} disabled={busy}>
            {busy
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.btnText}>Submit ticket</Text>}
          </Pressable>
        </ScrollView>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.historyList}>
          {tickets.length === 0 ? (
            <Text style={s.empty}>No tickets yet. Tap "New ticket" to get started.</Text>
          ) : (
            tickets.map(t => (
              <View key={t.id} style={s.ticketCard}>
                <View style={s.ticketRow}>
                  <Text style={s.ticketSubject} numberOfLines={1}>{t.subject}</Text>
                  <View style={[s.badge, { backgroundColor: STATUS_COLORS[t.status] ?? '#6B7280' }]}>
                    <Text style={s.badgeText}>{t.status}</Text>
                  </View>
                </View>
                <Text style={s.ticketMeta}>{t.category} · {t.createdAt}</Text>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:           { flex: 1, backgroundColor: colors.bgCanvas },
  header:         { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12, borderBottomWidth: 1, borderBottomColor: '#F0F0F5' },
  back:           { paddingRight: 8 },
  backText:       { fontSize: 16, color: colors.primary ?? '#2563EB', fontWeight: '600' },
  heading:        { fontSize: 18, fontWeight: '800', color: colors.ink },
  tabs:           { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  tab:            { flex: 1, paddingVertical: 8, borderRadius: radius.md, backgroundColor: '#F3F4F6', alignItems: 'center' },
  tabActive:      { backgroundColor: colors.primary ?? '#2563EB' },
  tabText:        { fontSize: 13, fontWeight: '700', color: colors.ink500 },
  tabTextActive:  { color: '#fff' },
  form:           { padding: 16, gap: 8 },
  label:          { fontSize: 12, fontWeight: '700', color: colors.ink, marginTop: 8 },
  required:       { color: '#EF4444' },
  input:          { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: radius.md, padding: 12, fontSize: 14, color: colors.ink },
  textarea:       { height: 120 },
  categoryRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip:           { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#F3F4F6' },
  chipActive:     { backgroundColor: colors.primary ?? '#2563EB' },
  chipText:       { fontSize: 12, fontWeight: '600', color: colors.ink500 },
  chipTextActive: { color: '#fff' },
  btn:            { marginTop: 16, backgroundColor: colors.primary ?? '#2563EB', borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
  btnDisabled:    { opacity: 0.6 },
  btnText:        { color: '#fff', fontWeight: '800', fontSize: 15 },
  historyList:    { padding: 16, gap: 10 },
  ticketCard:     { backgroundColor: '#fff', borderRadius: radius.md, padding: 14, gap: 4 },
  ticketRow:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ticketSubject:  { flex: 1, fontSize: 14, fontWeight: '700', color: colors.ink },
  ticketMeta:     { fontSize: 11, color: colors.ink500 },
  badge:          { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  badgeText:      { fontSize: 10, fontWeight: '700', color: '#fff', textTransform: 'uppercase' },
  empty:          { textAlign: 'center', color: colors.ink500, marginTop: 40, fontSize: 13 },
});
