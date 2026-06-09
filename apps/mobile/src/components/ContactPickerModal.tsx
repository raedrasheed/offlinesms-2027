// ContactPickerModal — pick a phone number from the device's address book.
//
// Permission-gated via `request('contacts')`. Only the rows the user actually
// taps leave this component — we never persist the full address book. Phone
// numbers are normalised to E.164 (uses the picker's defaultCountry hint) so
// invalid entries are quietly skipped.

import { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, TextInput, Pressable, FlatList, StyleSheet,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import * as Contacts from 'expo-contacts';
import { request } from '../lib/permissions';
import { normalizePhoneToE164 } from '../lib/phone';
import { avatarColor, initials } from '../lib/avatar';
import { colors, radius } from '../theme';
import { LoadingState, EmptyState, PermissionState } from './state';

export type PickedContact = { name: string; phoneE164: string };

type Props = {
  visible:        boolean;
  defaultCountry?: string;     // dial code, e.g. '+970'
  onClose:        () => void;
  onPick:         (c: PickedContact) => void;
};

type Row = { id: string; name: string; phoneE164: string };

function dedupeByPhone(rows: Row[]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const r of rows) {
    if (seen.has(r.phoneE164)) continue;
    seen.add(r.phoneE164);
    out.push(r);
  }
  return out;
}

export function ContactPickerModal({ visible, defaultCountry, onClose, onPick }: Props) {
  const [perm, setPerm] = useState<'undetermined' | 'granted' | 'denied'>('undetermined');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [term, setTerm] = useState('');

  useEffect(() => {
    if (!visible) return;
    setTerm('');
    (async () => {
      const status = await request('contacts');
      setPerm(status);
      if (status !== 'granted') { setRows([]); return; }
      try {
        const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
        const out: Row[] = [];
        for (const c of data) {
          const name = (c.name ?? c.firstName ?? '').trim();
          if (!c.phoneNumbers || c.phoneNumbers.length === 0) continue;
          for (const pn of c.phoneNumbers) {
            const raw = pn.number ?? '';
            const e164 = normalizePhoneToE164(raw, defaultCountry);
            if (!e164) continue;
            out.push({ id: `${c.id}_${e164}`, name: name || e164, phoneE164: e164 });
          }
        }
        out.sort((a, b) => a.name.localeCompare(b.name));
        setRows(dedupeByPhone(out));
      } catch {
        setRows([]);
      }
    })();
  }, [visible, defaultCountry]);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return rows ?? [];
    return (rows ?? []).filter(r => r.name.toLowerCase().includes(q) || r.phoneE164.includes(q));
  }, [rows, term]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.root}>
        <View style={s.header}>
          <Pressable onPress={onClose} hitSlop={12}><Text style={s.close}>✕</Text></Pressable>
          <Text style={s.title}>Choose contact</Text>
          <View style={{ width: 28 }} />
        </View>

        {perm === 'denied' ? (
          <PermissionState
            fullPage
            title="Contacts permission required"
            description="Enable contacts access in Settings to pick someone from your address book."
          />
        ) : rows === null ? (
          <View style={s.centered}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <>
            <TextInput
              style={s.search}
              value={term}
              onChangeText={setTerm}
              placeholder="Search name or number"
              autoCorrect={false}
              autoCapitalize="none"
            />
            <FlatList
              data={filtered}
              keyExtractor={r => r.id}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <EmptyState
                  compact
                  title={rows.length === 0 ? 'No contacts found' : 'No matches'}
                  description={rows.length === 0 ? 'Your address book has no numbers we can use.' : undefined}
                />
              }
              renderItem={({ item }) => (
                <Pressable style={s.row} onPress={() => onPick(item)}>
                  <View style={[s.avatar, { backgroundColor: avatarColor(item.id) }]}>
                    <Text style={s.avatarText}>{initials(item.name)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name} numberOfLines={1}>{item.name}</Text>
                    <Text style={s.phone}>{item.phoneE164}</Text>
                  </View>
                </Pressable>
              )}
            />
          </>
        )}
        {/* keep LoadingState import warm — unused in the happy path but cheap */}
        {false ? <LoadingState compact title="" /> : null}
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bgCanvas },
  header:  { paddingTop: 4, paddingBottom: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close:   { fontSize: 22, color: colors.ink500, width: 28 },
  title:   { fontSize: 15, fontWeight: '800', color: colors.ink },
  search:  { marginHorizontal: 14, marginBottom: 8, padding: 12, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink200, fontSize: 14, color: colors.ink },
  centered:{ flex: 1, alignItems: 'center', justifyContent: 'center' },
  row:     { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginHorizontal: 14, marginBottom: 6, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100 },
  avatar:  { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700' },
  name:    { fontSize: 14, fontWeight: '700', color: colors.ink },
  phone:   { fontSize: 12, color: colors.ink500, marginTop: 2 },
});
