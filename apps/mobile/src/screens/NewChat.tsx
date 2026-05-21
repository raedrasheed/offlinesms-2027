// NewChat — pick a user by username and open a direct conversation.
//
// Phase 4 uses a simple username prefix search against the `users`
// collection. usernameLower is readable by every signed-in user per
// the Phase 2 rules; phone numbers and emails stay hidden because we
// never select them.

import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import {
  collection, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { getOrCreateDirectConversation } from '../lib/conversations';
import { colors, radius } from '../theme';
import { LoadingState, EmptyState, ErrorState } from '../components/state';
import { normalizeUsername } from '../lib/username';

type UserRow = {
  uid:           string;
  displayName?:  string;
  username?:     string;
  usernameLower?: string;
};

export default function NewChat({ navigation }: any) {
  const [term, setTerm]   = useState('');
  const [rows, setRows]   = useState<UserRow[] | null>([]);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  // Debounced prefix search. Skips empty queries to avoid listing all users.
  useEffect(() => {
    const t = normalizeUsername(term);
    if (!t) { setRows([]); return; }
    setBusy(true);
    setErr(null);
    const handle = setTimeout(async () => {
      try {
        const q = query(
          collection(db, 'users'),
          orderBy('usernameLower'),
          where('usernameLower', '>=', t),
          where('usernameLower', '<=', t + ''),
          limit(20),
        );
        const snap = await getDocs(q);
        const me = auth.currentUser?.uid;
        const list: UserRow[] = [];
        for (const d of snap.docs) {
          if (d.id === me) continue;
          const data = d.data() as UserRow;
          list.push({
            uid:           d.id,
            displayName:   data.displayName,
            username:      data.username,
            usernameLower: data.usernameLower,
          });
        }
        setRows(list);
      } catch (e: any) {
        setErr(e?.message ?? 'search-failed');
        setRows([]);
      } finally {
        setBusy(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [term]);

  async function pick(uid: string) {
    setBusy(true); setErr(null);
    try {
      const conversationId = await getOrCreateDirectConversation(uid);
      navigation.replace('Conversation', { id: conversationId });
    } catch (e: any) {
      setErr(e?.message ?? 'open-conversation-failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()}><Text style={s.back}>‹</Text></Pressable>
        <Text style={s.title}>New chat</Text>
      </View>
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
        <ErrorState compact title="Search failed" description={err} />
      ) : busy ? (
        <LoadingState compact title="Searching…" />
      ) : !term ? (
        <EmptyState
          compact
          title="Find someone to chat with"
          description="Type a username to search. Direct chats are private."
        />
      ) : (rows ?? []).length === 0 ? (
        <EmptyState compact title="No matches" description={`No user with username starting with "${term}".`} />
      ) : (
        <FlatList
          data={rows ?? []}
          keyExtractor={u => u.uid}
          renderItem={({ item }) => (
            <Pressable style={s.row} onPress={() => pick(item.uid)}>
              <View style={s.avatar}><Text style={s.avatarText}>{(item.displayName ?? item.username ?? '?').slice(0, 1).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{item.displayName ?? '—'}</Text>
                <Text style={s.handle}>@{item.username ?? item.usernameLower}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: colors.bgCanvas },
  header:     { paddingTop: 50, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back:       { fontSize: 24, color: colors.primary },
  title:      { fontSize: 14, fontWeight: '700', color: colors.ink },
  input:      { margin: 14, padding: 12, backgroundColor: '#fff', borderRadius: radius.md, fontSize: 15, borderWidth: 1, borderColor: colors.ink200 },
  row:        { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginHorizontal: 14, marginBottom: 6, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink100 },
  avatar:     { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700' },
  name:       { fontSize: 14, fontWeight: '700', color: colors.ink },
  handle:     { fontSize: 12, color: colors.ink500, marginTop: 2 },
});
