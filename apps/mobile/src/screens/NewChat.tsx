// NewChat — pick a user by username and open a direct conversation.
//
// Phase 4 uses a simple username prefix search against the `users`
// collection. usernameLower is readable by every signed-in user per
// the Phase 2 rules; phone numbers and emails stay hidden because we
// never select them.

import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  collection, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { getOrCreateDirectConversation } from '../lib/conversations';
import { colors, radius } from '../theme';
import { LoadingState, EmptyState, ErrorState } from '../components/state';
import { normalizeUsername } from '../lib/username';
import { avatarColor, initials } from '../lib/avatar';

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

  const hasResults = (rows ?? []).length > 0;

  return (
    <SafeAreaView style={s.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={s.searchBar}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.ink} />
          </Pressable>
          <Ionicons name="search" size={18} color={colors.ink400} />
          <TextInput
            style={s.input}
            value={term}
            onChangeText={setTerm}
            placeholder="Search name or @username"
            placeholderTextColor={colors.ink400}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
        </View>

        {err ? (
          <ErrorState compact title="Search failed" description={err} />
        ) : busy ? (
          <LoadingState compact title="Searching…" />
        ) : !term ? (
          <EmptyState
            compact
            title="Find someone to chat with"
            description="Type a name or username to search. Direct chats are private."
          />
        ) : !hasResults ? (
          <View>
            <Text style={s.sectionLabel}>Not on OfflineSMS</Text>
            <EmptyState
              compact
              title="No matches"
              description={`No one with “${term}” is on OfflineSMS yet. Sync contacts to invite friends.`}
            />
          </View>
        ) : (
          <FlatList
            data={rows ?? []}
            keyExtractor={u => u.uid}
            ListHeaderComponent={<Text style={s.sectionLabel}>Recent</Text>}
            renderItem={({ item }) => {
              const name = item.displayName ?? item.username ?? '—';
              return (
                <Pressable style={s.row} onPress={() => pick(item.uid)}>
                  <View style={[s.avatar, { backgroundColor: avatarColor(item.uid) }]}>
                    <Text style={s.avatarText}>{initials(name)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name} numberOfLines={1}>{name}</Text>
                    <Text style={s.handle} numberOfLines={1}>@{item.username ?? item.usernameLower}</Text>
                  </View>
                </Pressable>
              );
            }}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: '#fff' },
  searchBar:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.ink100 },
  input:      { flex: 1, fontSize: 16, color: colors.ink, padding: 0 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: colors.ink500, letterSpacing: 0.5, textTransform: 'uppercase', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8 },
  row:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  avatar:     { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  name:       { fontSize: 15, fontWeight: '700', color: colors.ink },
  handle:     { fontSize: 13, color: colors.ink500, marginTop: 2 },
});
