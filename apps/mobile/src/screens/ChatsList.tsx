import { useEffect, useMemo, useState } from 'react';
import {
  FlatList, View, Text, Pressable, StyleSheet, TextInput,
} from 'react-native';
import {
  collection, onSnapshot, doc, query, where,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import {
  subscribeConversations,
  Conversation,
  UserState,
} from '../lib/conversations';
import { colors, radius } from '../theme';
import { LoadingState, EmptyState } from '../components/state';

type Filter = 'all' | 'unread' | 'favorites' | 'archived';

type Row = Conversation & {
  state?:        UserState;
  peerName?:     string;
  someoneTyping: boolean;
};

function formatTime(ts?: any): string {
  const d: Date | null = ts?.toDate?.() ?? null;
  if (!d) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ChatsList({ navigation }: any) {
  const me = auth.currentUser?.uid;
  const [rows, setRows] = useState<Conversation[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  // Per-conversation state + typing + peer profile, keyed by conversation id.
  const [states, setStates]   = useState<Record<string, UserState | undefined>>({});
  const [typing, setTyping]   = useState<Record<string, boolean>>({});
  const [peers, setPeers]     = useState<Record<string, { name?: string }>>({});

  // Conversations list.
  useEffect(() => subscribeConversations(setRows), []);

  // Per-conversation subscriptions: userState + typing + peer display name.
  useEffect(() => {
    if (!me || !rows) return;
    const unsubs: Array<() => void> = [];
    for (const c of rows) {
      // user state
      unsubs.push(onSnapshot(doc(db, 'conversations', c.id, 'userState', me), snap => {
        setStates(prev => ({ ...prev, [c.id]: snap.exists() ? ({ uid: me, ...snap.data() } as UserState) : undefined }));
      }));
      // typing
      unsubs.push(onSnapshot(
        query(collection(db, 'conversations', c.id, 'typing'), where('isTyping', '==', true)),
        snap => {
          const now = Date.now();
          let live = false;
          for (const d of snap.docs) {
            if (d.id === me) continue;
            const exp = (d.data().expiresAt?.toMillis?.() ?? 0) as number;
            if (exp > now) { live = true; break; }
          }
          setTyping(prev => ({ ...prev, [c.id]: live }));
        },
      ));
      // peer profile (direct conversations only)
      if (c.type === 'direct' && c.participantUids?.length === 2) {
        const peerUid = c.participantUids.find(u => u !== me);
        if (peerUid && !peers[peerUid]) {
          unsubs.push(onSnapshot(doc(db, 'users', peerUid), snap => {
            const data = snap.data() as { displayName?: string; username?: string } | undefined;
            const name = data?.displayName || (data?.username ? `@${data.username}` : peerUid.slice(0, 6));
            setPeers(prev => ({ ...prev, [c.id]: { name } }));
          }));
        }
      }
    }
    return () => { for (const u of unsubs) try { u(); } catch {} };
  }, [me, rows]);

  const enriched: Row[] = useMemo(() => {
    if (!rows) return [];
    return rows.map(c => ({
      ...c,
      state:         states[c.id],
      peerName:      peers[c.id]?.name ?? c.name ?? 'Conversation',
      someoneTyping: typing[c.id] ?? false,
    }));
  }, [rows, states, peers, typing]);

  const filtered = useMemo(() => {
    let out = enriched;
    if (filter === 'unread')     out = out.filter(c => (c.state?.unreadCount ?? 0) > 0);
    if (filter === 'favorites')  out = out.filter(c => c.state?.favorite === true);
    if (filter === 'archived')   out = out.filter(c => c.state?.archived === true);
    else                         out = out.filter(c => c.state?.archived !== true);

    const t = search.trim().toLowerCase();
    if (t) out = out.filter(c => (c.peerName ?? '').toLowerCase().includes(t));
    return out;
  }, [enriched, filter, search]);

  if (rows === null) return <LoadingState fullPage title="Loading chats…" />;

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.h1}>Chats</Text>
        <TextInput
          style={s.search}
          placeholder="Search chats"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
        <View style={s.chips}>
          {(['all','unread','favorites','archived'] as Filter[]).map(f => (
            <Pressable key={f} style={[s.chip, filter === f && s.chipActive]} onPress={() => setFilter(f)}>
              <Text style={[s.chipText, filter === f && s.chipTextActive]}>
                {f === 'all' ? 'All' : f === 'unread' ? 'Unread' : f === 'favorites' ? 'Favorites' : 'Archived'}
              </Text>
            </Pressable>
          ))}
          <Pressable style={[s.chip, s.chipDisabled]} disabled>
            <Text style={[s.chipText, { color: colors.ink400 }]}>Groups</Text>
          </Pressable>
        </View>
      </View>

      {filtered.length === 0 ? (
        <EmptyState
          fullPage
          title={
            filter === 'unread'    ? 'Nothing unread' :
            filter === 'favorites' ? 'No favorite chats yet' :
            filter === 'archived'  ? 'No archived chats' :
            'No conversations yet'
          }
          description={filter === 'all' ? 'Tap the + button to start a new chat.' : undefined}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={r => r.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 96 }}
          renderItem={({ item }) => (
            <Pressable style={s.row} onPress={() => navigation.navigate('Conversation', { id: item.id })}>
              <View style={s.av}>
                <Text style={s.avText}>{(item.peerName ?? '?').slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={s.rowTop}>
                  <Text style={s.name} numberOfLines={1}>{item.peerName}</Text>
                  <Text style={s.time}>{formatTime(item.state?.lastMessageAt ?? item.lastMessageAt)}</Text>
                </View>
                <View style={s.rowBot}>
                  <Text style={s.preview} numberOfLines={1}>
                    {item.someoneTyping
                      ? 'typing…'
                      : (item.state?.lastMessagePreview || item.lastMessageText || '')}
                  </Text>
                  <View style={s.badges}>
                    {item.state?.pinned   ? <Text style={s.tag}>📌</Text> : null}
                    {item.state?.muted    ? <Text style={s.tag}>🔕</Text> : null}
                    {(item.state?.unreadCount ?? 0) > 0 ? (
                      <View style={s.unread}>
                        <Text style={s.unreadText}>
                          {(item.state?.unreadCount ?? 0) > 99 ? '99+' : item.state?.unreadCount}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>
            </Pressable>
          )}
        />
      )}

      <Pressable style={s.fab} onPress={() => navigation.navigate('NewChat')}>
        <Text style={s.fabText}>+</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: colors.bgCanvas },
  header:      { padding: 14, paddingTop: 50, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.ink100, gap: 10 },
  h1:          { fontSize: 24, fontWeight: '800', color: colors.ink },
  search:      { padding: 10, backgroundColor: colors.surface2, borderRadius: radius.md, fontSize: 14 },
  chips:       { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip:        { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.ink200 },
  chipActive:  { backgroundColor: colors.primary, borderColor: colors.primary },
  chipDisabled:{ opacity: 0.5 },
  chipText:    { fontSize: 12, color: colors.ink700, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  row:         { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, marginBottom: 6, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.ink100 },
  av:          { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avText:      { color: '#fff', fontWeight: '700' },
  rowTop:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  rowBot:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2, gap: 6 },
  name:        { fontSize: 14, fontWeight: '700', color: colors.ink, flex: 1 },
  time:        { fontSize: 11, color: colors.ink500 },
  preview:     { fontSize: 12, color: colors.ink500, flex: 1 },
  badges:      { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tag:         { fontSize: 12 },
  unread:      { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  unreadText:  { color: '#fff', fontSize: 11, fontWeight: '800' },
  fab:         { position: 'absolute', right: 18, bottom: 22, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
  fabText:     { color: '#fff', fontSize: 28, fontWeight: '700', marginTop: -2 },
});
