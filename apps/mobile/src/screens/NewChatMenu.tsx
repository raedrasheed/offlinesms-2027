// Create-group / new-chat flow · Step 1 — "New chat" menu.
//
// Entry point reached from the Chats FAB. Offers New group / New contact /
// New community, plus a username search that opens a direct chat when a
// person is tapped.

import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable, StyleSheet, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  collection, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db, auth } from '../lib/firebase';
import { getOrCreateDirectConversation } from '../lib/conversations';
import { normalizeUsername } from '../lib/username';
import { colors, radius } from '../theme';
import { avatarColor, initials } from '../lib/avatar';
import { LoadingState } from '../components/state';

type UserRow = { uid: string; displayName?: string; username?: string };

export default function NewChatMenu({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const me = auth.currentUser?.uid;
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<UserRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    const t = normalizeUsername(term);
    if (!t) { setRows([]); return; }
    setBusy(true);
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
      } catch { setRows([]); }
      finally { setBusy(false); }
    }, 200);
    return () => clearTimeout(handle);
  }, [term, me]);

  async function openDirect(uid: string) {
    setOpening(true);
    try {
      const conversationId = await getOrCreateDirectConversation(uid);
      navigation.replace('Conversation', { id: conversationId });
    } catch (e: any) {
      Alert.alert('Couldn’t open chat', e?.message ?? 'Please try again.');
    } finally { setOpening(false); }
  }

  const menu = useMemo(() => ([
    { key: 'group',     icon: 'people' as const,         label: 'New group',     onPress: () => navigation.navigate('NewGroup') },
    { key: 'contact',   icon: 'person-add' as const,     label: 'New contact',   onPress: () => navigation.navigate('NewChat') },
    { key: 'community', icon: 'globe-outline' as const,  label: 'New community', onPress: () => Alert.alert('Communities', 'Coming soon.') },
  ]), [navigation]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
        </Pressable>
        <Text style={s.title}>New chat</Text>
        <View style={{ width: 24 }} />
      </View>

      <TextInput
        style={s.search}
        value={term}
        onChangeText={setTerm}
        placeholder="Search name or number"
        placeholderTextColor={colors.ink400}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {term ? null : menu.map((m, i) => (
        <Pressable key={m.key} style={[s.menuRow, i === 0 && s.menuRowActive]} onPress={m.onPress}>
          <View style={[s.menuIcon, i === 0 && { backgroundColor: colors.primary }]}>
            <Ionicons name={m.icon} size={20} color={i === 0 ? '#fff' : colors.primary} />
          </View>
          <Text style={s.menuLabel}>{m.label}</Text>
        </Pressable>
      ))}

      <Text style={s.sectionLabel}>CONTACTS ON OFFLINESMS</Text>

      {opening ? (
        <LoadingState compact title="Opening…" />
      ) : busy && term ? (
        <LoadingState compact title="Searching…" />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={u => u.uid}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={
            <Text style={s.hint}>
              {term ? 'No matches.' : 'Search by name or @username to start a direct chat.'}
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable style={s.row} onPress={() => openDirect(item.uid)}>
              <View style={[s.av, { backgroundColor: avatarColor(item.uid) }]}>
                <Text style={s.avText}>{initials(item.displayName ?? item.username ?? '?')}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.name} numberOfLines={1}>{item.displayName ?? item.username ?? '—'}</Text>
                <Text style={s.handle} numberOfLines={1}>@{item.username ?? item.uid.slice(0, 6)}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.surface },
  header:  { paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 12 },
  title:   { fontSize: 18, fontWeight: '800', color: colors.ink, flex: 1 },
  search:  { marginHorizontal: 14, marginTop: 4, marginBottom: 4, padding: 12, backgroundColor: colors.surface2, borderRadius: radius.md, fontSize: 15, color: colors.ink },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 12, paddingHorizontal: 16 },
  menuRowActive: { backgroundColor: colors.primaryLight },
  menuIcon:{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { fontSize: 16, fontWeight: '700', color: colors.ink },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: colors.ink500, letterSpacing: 0.6, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6 },
  hint:    { fontSize: 13, color: colors.ink500, paddingHorizontal: 16, paddingTop: 8 },
  row:     { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, paddingHorizontal: 16 },
  av:      { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avText:  { color: '#fff', fontWeight: '800', fontSize: 16 },
  name:    { fontSize: 15, fontWeight: '700', color: colors.ink },
  handle:  { fontSize: 13, color: colors.ink500, marginTop: 2 },
});
