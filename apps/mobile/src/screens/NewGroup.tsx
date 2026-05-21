// NewGroup — pick members and a name, call createGroup.
//
// Reuses the Phase 4 username prefix-search. Member chips are stored
// locally; users currently in the chips list are filtered out of the
// search results. Caller is owner; max 256 members is enforced
// server-side.

import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import {
  collection, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { createGroup, groupErrorCopy } from '../lib/conversations';
import { normalizeUsername } from '../lib/username';
import { colors, radius } from '../theme';
import { LoadingState, EmptyState, ErrorState } from '../components/state';

type UserRow = {
  uid: string;
  displayName?: string;
  username?: string;
};

const NAME_MAX = 80;
const HARD_CAP = 256;

export default function NewGroup({ navigation }: any) {
  const me = auth.currentUser?.uid;
  const [name, setName]   = useState('');
  const [term, setTerm]   = useState('');
  const [rows, setRows]   = useState<UserRow[] | null>([]);
  const [selected, setSelected] = useState<UserRow[]>([]);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);

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
          if (selectedIds.has(d.id)) continue;
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
  }, [term, me, selectedIds]);

  function add(u: UserRow) {
    if (selected.length + 1 >= HARD_CAP) return;
    setSelected(s => [...s, u]);
    setTerm('');
  }
  function remove(uid: string) {
    setSelected(s => s.filter(u => u.uid !== uid));
  }

  const canSubmit = name.trim().length > 0 && selected.length >= 1 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setErr(null);
    try {
      const res = await createGroup({
        name: name.trim(),
        memberUids: selected.map(s => s.uid),
      });
      navigation.replace('Conversation', { id: res.conversationId });
    } catch (e: any) {
      setErr(groupErrorCopy(e?.code ?? 'internal'));
    } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()}><Text style={s.back}>‹</Text></Pressable>
        <Text style={s.title}>New group</Text>
        <Pressable
          style={[s.createBtn, !canSubmit && { opacity: 0.4 }]}
          onPress={submit}
          disabled={!canSubmit}
        >
          <Text style={s.createText}>{busy ? '…' : 'Create'}</Text>
        </Pressable>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        <Text style={s.label}>Group name</Text>
        <TextInput
          style={s.input}
          value={name}
          onChangeText={setName}
          maxLength={NAME_MAX}
          placeholder="e.g. Weekend trip planning"
          autoCapitalize="sentences"
        />

        <Text style={s.label}>Members</Text>
        {selected.length === 0 ? (
          <Text style={s.hint}>Add at least one member.</Text>
        ) : (
          <View style={s.chips}>
            {selected.map(u => (
              <Pressable key={u.uid} style={s.chip} onPress={() => remove(u.uid)}>
                <Text style={s.chipText}>{u.displayName ?? u.username ?? u.uid.slice(0, 6)}  ×</Text>
              </Pressable>
            ))}
          </View>
        )}

        <TextInput
          style={s.input}
          value={term}
          onChangeText={setTerm}
          placeholder="Search by username"
          autoCapitalize="none"
          autoCorrect={false}
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
  label:  { fontSize: 12, fontWeight: '700', color: colors.ink700, marginTop: 14, marginBottom: 6, letterSpacing: 0.4, paddingHorizontal: 14 },
  input:  { marginHorizontal: 14, padding: 12, backgroundColor: '#fff', borderRadius: radius.md, fontSize: 15, borderWidth: 1, borderColor: colors.ink200 },
  hint:   { fontSize: 12, color: colors.ink500, paddingHorizontal: 14 },
  chips:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 14, marginBottom: 10 },
  chip:   { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.primaryLight },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.primaryDark },
  row:    { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginHorizontal: 14, marginBottom: 6, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700' },
  name:   { fontSize: 14, fontWeight: '700', color: colors.ink },
  handle: { fontSize: 12, color: colors.ink500, marginTop: 2 },
  add:    { fontSize: 22, color: colors.primary, fontWeight: '700' },
});
