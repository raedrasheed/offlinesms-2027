// Create-group flow · Step 2 — "Add members".
//
// Multi-select people via username search. Selected people appear as chips
// with a running N/256 counter; tapping a row toggles selection. "Next"
// carries the selection to the Group info screen (Step 3) which performs the
// actual createGroup call.

import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  collection, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db, auth } from '../lib/firebase';
import { normalizeUsername } from '../lib/username';
import { colors, radius } from '../theme';
import { avatarColor, initials } from '../lib/avatar';
import { LoadingState, EmptyState, ErrorState } from '../components/state';

type UserRow = { uid: string; displayName?: string; username?: string };
const HARD_CAP = 256;

export default function NewGroup({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const me = auth.currentUser?.uid;
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<UserRow[]>([]);
  const [selected, setSelected] = useState<UserRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
          const data = d.data() as UserRow;
          list.push({ uid: d.id, displayName: data.displayName, username: data.username });
        }
        setRows(list);
      } catch (e: any) { setErr(e?.message ?? 'search-failed'); setRows([]); }
      finally { setBusy(false); }
    }, 200);
    return () => clearTimeout(handle);
  }, [term, me]);

  function toggle(u: UserRow) {
    setSelected(prev =>
      prev.some(p => p.uid === u.uid)
        ? prev.filter(p => p.uid !== u.uid)
        : (prev.length >= HARD_CAP ? prev : [...prev, u]),
    );
  }

  // Selected people always appear first; search results follow (de-duped).
  const listData = useMemo(() => {
    const map = new Map<string, UserRow>();
    for (const u of selected) map.set(u.uid, u);
    for (const u of rows) if (!map.has(u.uid)) map.set(u.uid, u);
    return [...map.values()];
  }, [selected, rows]);

  const canNext = selected.length >= 1;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
        </Pressable>
        <Text style={s.title}>Add members</Text>
        <Pressable
          onPress={() => canNext && navigation.navigate('GroupCreateInfo', { members: selected })}
          disabled={!canNext}
          hitSlop={10}
        >
          <Text style={[s.next, !canNext && { opacity: 0.4 }]}>Next</Text>
        </Pressable>
      </View>

      {selected.length > 0 ? (
        <View style={s.selectedWrap}>
          <View style={s.chips}>
            {selected.map(u => (
              <Pressable key={u.uid} style={s.chip} onPress={() => toggle(u)}>
                <View style={[s.chipAv, { backgroundColor: avatarColor(u.uid) }]}>
                  <Text style={s.chipAvText}>{initials(u.displayName ?? u.username ?? '?')}</Text>
                </View>
                <Text style={s.chipText} numberOfLines={1}>{u.displayName ?? u.username ?? u.uid.slice(0, 6)}</Text>
                <Ionicons name="close" size={14} color={colors.primaryDark} />
              </Pressable>
            ))}
            <Text style={s.counter}>{selected.length} / {HARD_CAP}</Text>
          </View>
        </View>
      ) : null}

      <TextInput
        style={s.search}
        value={term}
        onChangeText={setTerm}
        placeholder="Search name or number"
        placeholderTextColor={colors.ink400}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {selected.length > 0 ? <Text style={s.sectionLabel}>SELECTED · {selected.length}</Text> : null}

      {err ? (
        <ErrorState compact title="Search failed" description={err} />
      ) : busy && term ? (
        <LoadingState compact title="Searching…" />
      ) : listData.length === 0 ? (
        <EmptyState
          compact
          title={term ? 'No matches' : 'Search to add people'}
          description={term ? undefined : 'Type a name or @username to find people to add.'}
        />
      ) : (
        <FlatList
          data={listData}
          keyExtractor={u => u.uid}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 24 }}
          renderItem={({ item }) => {
            const on = selectedIds.has(item.uid);
            return (
              <Pressable style={s.row} onPress={() => toggle(item)}>
                <View style={[s.av, { backgroundColor: avatarColor(item.uid) }]}>
                  <Text style={s.avText}>{initials(item.displayName ?? item.username ?? '?')}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.name} numberOfLines={1}>{item.displayName ?? item.username ?? '—'}</Text>
                  <Text style={s.handle} numberOfLines={1}>@{item.username ?? item.uid.slice(0, 6)}</Text>
                </View>
                <Ionicons
                  name={on ? 'checkmark-circle' : 'ellipse-outline'}
                  size={24}
                  color={on ? colors.primary : colors.ink300}
                />
              </Pressable>
            );
          }}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.surface },
  header:  { paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 12 },
  title:   { fontSize: 18, fontWeight: '800', color: colors.ink, flex: 1 },
  next:    { fontSize: 16, fontWeight: '700', color: colors.primary },
  selectedWrap: { paddingHorizontal: 14, paddingTop: 8 },
  chips:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 8, borderRadius: radius.pill, backgroundColor: colors.primaryLight, maxWidth: 180 },
  chipAv:  { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  chipAvText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  chipText:{ fontSize: 13, fontWeight: '600', color: colors.primaryDark, flexShrink: 1 },
  counter: { fontSize: 12, color: colors.ink500, marginLeft: 4 },
  search:  { marginHorizontal: 14, marginTop: 12, padding: 12, backgroundColor: colors.surface2, borderRadius: radius.md, fontSize: 15, color: colors.ink },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: colors.ink500, letterSpacing: 0.6, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  row:     { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, paddingHorizontal: 16 },
  av:      { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avText:  { color: '#fff', fontWeight: '800', fontSize: 16 },
  name:    { fontSize: 15, fontWeight: '700', color: colors.ink },
  handle:  { fontSize: 13, color: colors.ink500, marginTop: 2 },
});
