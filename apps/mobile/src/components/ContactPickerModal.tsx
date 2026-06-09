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
  /** Enable multi-select mode. When set, `onPickMulti` fires with the picked
   *  contacts once the user confirms; the single-select `onPick` is skipped. */
  multi?:         boolean;
  onPickMulti?:   (cs: PickedContact[]) => void;
  /** Maximum number of contacts selectable at once. Defaults to 256. */
  maxSelect?:     number;
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

export function ContactPickerModal({ visible, defaultCountry, onClose, onPick, multi, onPickMulti, maxSelect = 256 }: Props) {
  const [perm, setPerm] = useState<'undetermined' | 'granted' | 'denied'>('undetermined');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<Record<string, Row>>({});

  useEffect(() => {
    if (!visible) return;
    setTerm('');
    setSelected({});
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

  const selectedCount = Object.keys(selected).length;
  const atCap = selectedCount >= maxSelect;
  function toggle(r: Row) {
    setSelected(prev => {
      if (prev[r.id]) { const { [r.id]: _drop, ...rest } = prev; return rest; }
      if (Object.keys(prev).length >= maxSelect) return prev;
      return { ...prev, [r.id]: r };
    });
  }
  function done() {
    if (!multi || !onPickMulti) return;
    const picked = Object.values(selected).map(r => ({ name: r.name, phoneE164: r.phoneE164 }));
    if (picked.length === 0) return;
    onPickMulti(picked);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.root}>
        <View style={s.header}>
          <Pressable onPress={onClose} hitSlop={12}><Text style={s.close}>✕</Text></Pressable>
          <Text style={s.title}>{multi ? `Choose contacts${selectedCount ? ` (${selectedCount})` : ''}` : 'Choose contact'}</Text>
          {multi ? (
            <Pressable onPress={done} hitSlop={12} disabled={selectedCount === 0} style={[s.doneBtn, selectedCount === 0 && { opacity: 0.4 }]}>
              <Text style={s.doneText}>Done</Text>
            </Pressable>
          ) : (
            <View style={{ width: 28 }} />
          )}
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
              renderItem={({ item }) => {
                const isSelected = !!selected[item.id];
                const disabled = multi && !isSelected && atCap;
                return (
                  <Pressable
                    style={[s.row, isSelected && s.rowOn, disabled && { opacity: 0.4 }]}
                    onPress={() => (multi ? toggle(item) : onPick(item))}
                    disabled={!!disabled}
                  >
                    <View style={[s.avatar, { backgroundColor: avatarColor(item.id) }]}>
                      <Text style={s.avatarText}>{initials(item.name)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.name} numberOfLines={1}>{item.name}</Text>
                      <Text style={s.phone}>{item.phoneE164}</Text>
                    </View>
                    {multi ? (
                      <View style={[s.check, isSelected && s.checkOn]}>
                        {isSelected ? <Text style={s.checkMark}>✓</Text> : null}
                      </View>
                    ) : null}
                  </Pressable>
                );
              }}
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
  rowOn:   { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  avatar:  { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700' },
  name:    { fontSize: 14, fontWeight: '700', color: colors.ink },
  phone:   { fontSize: 12, color: colors.ink500, marginTop: 2 },
  check:   { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.ink200, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkMark: { color: '#fff', fontWeight: '900', fontSize: 13, lineHeight: 13 },
  doneBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.primary },
  doneText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
