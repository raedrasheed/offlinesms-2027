// AddMembers — pick users and add them to an existing group.

import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import {
  collection, getDocs, limit, onSnapshot, orderBy, query, where,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { addGroupMembers, addExternalContactToGroup, groupErrorCopy } from '../lib/conversations';
import { normalizeUsername } from '../lib/username';
import { normalizePhoneToE164 } from '../lib/phone';
import { LOCAL_FIRST_CONVERSATION_ENABLED } from '../config/features';
import { queueAddExternalContactToGroup, getCurrentUid } from '../localdb';
import { ContactPickerModal, type PickedContact } from '../components/ContactPickerModal';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';
import { LoadingState, EmptyState, ErrorState } from '../components/state';

type UserRow = {
  uid: string;
  displayName?: string;
  username?: string;
};

export default function AddMembers({ route, navigation }: any) {
  const me = auth.currentUser?.uid;
  const { id } = route.params as { id: string };

  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<UserRow[] | null>([]);
  const [selected, setSelected] = useState<UserRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Track existing active members so we don't re-add them.
  useEffect(() => {
    return onSnapshot(collection(db, 'conversations', id, 'members'), snap => {
      const set = new Set<string>();
      for (const d of snap.docs) {
        if ((d.data().status ?? 'active') === 'active') set.add(d.id);
      }
      setExisting(set);
    });
  }, [id]);

  const selectedIds = useMemo(() => new Set(selected.map(s => s.uid)), [selected]);

  useEffect(() => {
    const t = normalizeUsername(term);
    if (!t) { setRows([]); return; }
    setBusy(true); setErr(null);
    const handle = setTimeout(async () => {
      try {
        const q = query(
          collection(db, 'users'),
          orderBy('usernameLower'),
          where('usernameLower', '>=', t),
          where('usernameLower', '<=', t + ''),
          limit(20),
        );
        const snap = await getDocs(q);
        const list: UserRow[] = [];
        for (const d of snap.docs) {
          if (d.id === me) continue;
          if (existing.has(d.id) || selectedIds.has(d.id)) continue;
          const data = d.data() as UserRow;
          list.push({ uid: d.id, displayName: data.displayName, username: data.username });
        }
        setRows(list);
      } catch (e: any) {
        setErr(e?.message ?? 'search-failed');
        setRows([]);
      } finally { setBusy(false); }
    }, 200);
    return () => clearTimeout(handle);
  }, [term, me, existing, selectedIds]);

  function add(u: UserRow) { setSelected(s => [...s, u]); setTerm(''); }
  function remove(uid: string) { setSelected(s => s.filter(u => u.uid !== uid)); }

  // ── Add by phone (external phone-only contact) ──
  const [phoneMode, setPhoneMode] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bulkPickerOpen, setBulkPickerOpen] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ total: number; done: number; failed: number } | null>(null);

  function applyPickedContact(c: PickedContact) {
    setContactName(c.name);
    setContactPhone(c.phoneE164);
    setPickerOpen(false);
  }

  // Bulk add: iterate the picked contacts, persisting each via the local-first
  // queue when available (so it survives offline / app restart), otherwise via
  // the direct callable. Errors per contact are counted but never block the
  // rest — we surface a single summary alert at the end.
  async function applyBulkPickedContacts(cs: PickedContact[]) {
    setBulkPickerOpen(false);
    if (cs.length === 0) return;
    const useLocalQueue = LOCAL_FIRST_CONVERSATION_ENABLED && !!getCurrentUid();
    setBusy(true); setErr(null);
    setBulkProgress({ total: cs.length, done: 0, failed: 0 });
    let done = 0; let failed = 0;
    for (const c of cs) {
      try {
        if (useLocalQueue) {
          await queueAddExternalContactToGroup({ conversationId: id, displayName: c.name, phoneE164: c.phoneE164 });
        } else {
          await addExternalContactToGroup({ conversationId: id, displayName: c.name, phoneNumber: c.phoneE164 });
        }
        done++;
      } catch {
        failed++;
      }
      setBulkProgress({ total: cs.length, done: done + failed, failed });
    }
    setBusy(false);
    setBulkProgress(null);
    const summary = failed === 0
      ? `Added ${done} contact${done === 1 ? '' : 's'} to the group.`
      : `Added ${done}, failed ${failed}. Try again for the failed ones.`;
    Alert.alert(failed === 0 ? 'Done' : 'Partially added', summary, [
      { text: 'OK', onPress: () => failed === 0 ? navigation.goBack() : undefined },
    ]);
  }

  async function addPhoneContact() {
    const name = contactName.trim();
    const e164 = normalizePhoneToE164(contactPhone.trim());
    if (!name) { Alert.alert('Name required', 'Enter a contact name.'); return; }
    if (!e164) { Alert.alert('Invalid number', 'Enter a phone number in international format, e.g. +972591234567.'); return; }
    setBusy(true); setErr(null);
    try {
      // Local-first: queue optimistically (survives offline + app restart, shows
      // immediately in GroupInfo). Falls back to the direct callable otherwise.
      if (LOCAL_FIRST_CONVERSATION_ENABLED && getCurrentUid()) {
        await queueAddExternalContactToGroup({ conversationId: id, displayName: name, phoneE164: e164 });
        navigation.goBack();
      } else {
        const res = await addExternalContactToGroup({ conversationId: id, displayName: name, phoneNumber: e164 });
        if (res.alreadyMember) Alert.alert('Already a member', 'That number already belongs to a member of this group.');
        else if (res.alreadyExternal) Alert.alert('Already added', 'That contact is already in this group.');
        else navigation.goBack();
      }
    } catch (e: any) {
      const copy = groupErrorCopy(e?.code ?? 'internal');
      setErr(copy);
      Alert.alert('Couldn’t add contact', copy);
    } finally { setBusy(false); }
  }

  const canSubmit = selected.length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setErr(null);
    try {
      await addGroupMembers(id, selected.map(u => u.uid));
      navigation.goBack();
    } catch (e: any) {
      const copy = groupErrorCopy(e?.code ?? 'internal');
      setErr(copy);
      Alert.alert('Couldn’t add members', copy);
    } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()}><Text style={s.back}>‹</Text></Pressable>
        <Text style={s.title}>Add members</Text>
        <Pressable style={[s.createBtn, !canSubmit && { opacity: 0.4 }]} onPress={submit} disabled={!canSubmit}>
          <Text style={s.createText}>{busy ? '…' : 'Add'}</Text>
        </Pressable>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={s.modeRow}>
          <Pressable style={[s.modeTab, !phoneMode && s.modeTabOn]} onPress={() => setPhoneMode(false)}>
            <Text style={[s.modeTabText, !phoneMode && s.modeTabTextOn]}>Registered users</Text>
          </Pressable>
          <Pressable style={[s.modeTab, phoneMode && s.modeTabOn]} onPress={() => setPhoneMode(true)}>
            <Text style={[s.modeTabText, phoneMode && s.modeTabTextOn]}>Add phone contact</Text>
          </Pressable>
        </View>

        {phoneMode ? (
          <View style={s.phonePanel}>
            <Text style={s.phoneHint}>Add someone by phone number. They’ll receive group messages by SMS, and become a full member automatically if they sign up with that number.</Text>
            <View style={s.pickRow}>
              <Pressable style={[s.pickBtn, { flex: 1 }]} onPress={() => setPickerOpen(true)} disabled={busy}>
                <Ionicons name="person-outline" size={18} color={colors.primary} />
                <Text style={s.pickBtnText}>Pick one</Text>
              </Pressable>
              <Pressable style={[s.pickBtn, { flex: 1 }]} onPress={() => setBulkPickerOpen(true)} disabled={busy}>
                <Ionicons name="people-outline" size={18} color={colors.primary} />
                <Text style={s.pickBtnText}>Pick many</Text>
              </Pressable>
            </View>
            {bulkProgress ? (
              <Text style={s.phoneHint}>Adding {bulkProgress.done} of {bulkProgress.total}{bulkProgress.failed > 0 ? ` · ${bulkProgress.failed} failed` : ''}…</Text>
            ) : null}
            <TextInput
              style={s.input}
              value={contactName}
              onChangeText={setContactName}
              placeholder="Name"
              autoFocus
            />
            <TextInput
              style={s.input}
              value={contactPhone}
              onChangeText={setContactPhone}
              placeholder="+972591234567"
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable style={[s.phoneBtn, busy && { opacity: 0.5 }]} onPress={addPhoneContact} disabled={busy}>
              <Text style={s.phoneBtnText}>{busy ? 'Adding…' : 'Add to group'}</Text>
            </Pressable>
            {err ? <ErrorState compact title="Couldn’t complete" description={err} /> : null}
            <ContactPickerModal
              visible={pickerOpen}
              onClose={() => setPickerOpen(false)}
              onPick={applyPickedContact}
            />
            <ContactPickerModal
              visible={bulkPickerOpen}
              multi
              onClose={() => setBulkPickerOpen(false)}
              onPick={() => { /* unused in multi */ }}
              onPickMulti={applyBulkPickedContacts}
            />
          </View>
        ) : (
        <>
        {selected.length > 0 ? (
          <View style={s.chips}>
            {selected.map(u => (
              <Pressable key={u.uid} style={s.chip} onPress={() => remove(u.uid)}>
                <Text style={s.chipText}>{u.displayName ?? u.username ?? u.uid.slice(0, 6)}  ×</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <TextInput
          style={s.input}
          value={term}
          onChangeText={setTerm}
          placeholder="Search by username"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />

        {err ? (
          <ErrorState compact title="Couldn’t complete" description={err} />
        ) : busy && term ? (
          <LoadingState compact title="Searching…" />
        ) : term && (rows ?? []).length === 0 ? (
          <EmptyState compact title="No matches" description={`No user with username starting with "${term}".`} />
        ) : null}

        {(rows ?? []).length > 0 ? (
          <FlatList
            scrollEnabled={false}
            data={rows ?? []}
            keyExtractor={u => u.uid}
            renderItem={({ item }) => (
              <Pressable style={s.row} onPress={() => add(item)}>
                <View style={s.avatar}><Text style={s.avatarText}>{(item.displayName ?? item.username ?? '?').slice(0, 1).toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{item.displayName ?? '—'}</Text>
                  <Text style={s.handle}>@{item.username ?? item.uid.slice(0, 6)}</Text>
                </View>
                <Text style={s.add}>＋</Text>
              </Pressable>
            )}
          />
        ) : null}
        </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: colors.bgCanvas },
  header: { paddingTop: 50, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back:   { fontSize: 24, color: colors.primary, width: 24 },
  title:  { fontSize: 14, fontWeight: '700', color: colors.ink, flex: 1 },
  createBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.primary },
  createText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  input:  { marginHorizontal: 14, marginTop: 14, padding: 12, backgroundColor: '#fff', borderRadius: radius.md, fontSize: 15, borderWidth: 1, borderColor: colors.ink200 },
  chips:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 14, paddingTop: 14 },
  chip:   { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.primaryLight },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.primaryDark },
  row:    { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginHorizontal: 14, marginBottom: 6, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700' },
  name:   { fontSize: 14, fontWeight: '700', color: colors.ink },
  handle: { fontSize: 12, color: colors.ink500, marginTop: 2 },
  add:    { fontSize: 22, color: colors.primary, fontWeight: '700' },
  modeRow:  { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 14 },
  modeTab:  { flex: 1, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.ink200, alignItems: 'center' },
  modeTabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  modeTabText:   { fontSize: 13, fontWeight: '700', color: colors.ink500 },
  modeTabTextOn: { color: '#fff' },
  phonePanel: { paddingHorizontal: 14, paddingTop: 8, gap: 12 },
  phoneHint:  { fontSize: 12, color: colors.ink500, lineHeight: 18, marginTop: 6 },
  phoneBtn:   { padding: 14, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center' },
  phoneBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  pickBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: colors.primary },
  pickBtnText:{ color: colors.primary, fontWeight: '700', fontSize: 14 },
  pickRow:    { flexDirection: 'row', gap: 8 },
});
