// ForwardPicker — pick target conversations and forward the selected
// messages from the source conversation. Phase 6 is text-only.

import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable, StyleSheet, Alert,
} from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import {
  subscribeConversations,
  forwardMessages,
  Conversation,
  groupErrorCopy,
} from '../lib/conversations';
import { colors, radius } from '../theme';
import { LoadingState, EmptyState, ErrorState } from '../components/state';

type Row = Conversation & { peerName: string };

export default function ForwardPicker({ route, navigation }: any) {
  const me = auth.currentUser?.uid;
  const { sourceConversationId, messageIds } = route.params as {
    sourceConversationId: string;
    messageIds: string[];
  };

  const [rows, setRows]         = useState<Conversation[] | null>(null);
  const [peers, setPeers]       = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch]     = useState('');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  useEffect(() => subscribeConversations(setRows), []);

  // Resolve peer names for direct conversations (lightweight).
  useEffect(() => {
    if (!me || !rows) return;
    const unsubs: Array<() => void> = [];
    for (const c of rows) {
      if (c.type !== 'direct' || !c.participantUids?.length) continue;
      const peerUid = c.participantUids.find(u => u !== me);
      if (!peerUid || peers[c.id]) continue;
      unsubs.push(onSnapshot(doc(db, 'users', peerUid), snap => {
        const u = snap.data() as { displayName?: string; username?: string } | undefined;
        const name = u?.displayName ?? (u?.username ? `@${u.username}` : peerUid.slice(0, 6));
        setPeers(prev => ({ ...prev, [c.id]: name }));
      }));
    }
    return () => { for (const u of unsubs) try { u(); } catch {} };
  }, [me, rows]);

  const enriched: Row[] = useMemo(() => {
    if (!rows) return [];
    return rows
      .filter(c => c.id !== sourceConversationId)
      .filter(c => c.status !== 'disabled')
      .map(c => ({
        ...c,
        peerName: c.type === 'group' ? (c.name ?? 'Group') : (peers[c.id] ?? 'Conversation'),
      }));
  }, [rows, peers, sourceConversationId]);

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return enriched;
    return enriched.filter(c => c.peerName.toLowerCase().includes(t));
  }, [enriched, search]);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (selected.size === 0 || busy) return;
    setBusy(true); setErr(null);
    try {
      const { forwarded, targets } = await forwardMessages({
        sourceConversationId,
        messageIds,
        targetConversationIds: Array.from(selected),
      });
      Alert.alert('Forwarded', `${forwarded} message${forwarded === 1 ? '' : 's'} sent to ${targets} chat${targets === 1 ? '' : 's'}.`);
      navigation.goBack();
    } catch (e: any) {
      setErr(groupErrorCopy(e?.code ?? 'internal'));
    } finally { setBusy(false); }
  }

  if (rows === null) return <LoadingState fullPage title="Loading conversations…" />;

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()}><Text style={s.back}>‹</Text></Pressable>
        <Text style={s.title}>Forward to…</Text>
        <Pressable
          style={[s.sendBtn, (selected.size === 0 || busy) && { opacity: 0.4 }]}
          onPress={submit}
          disabled={selected.size === 0 || busy}
        >
          <Text style={s.sendText}>{busy ? '…' : `Send (${selected.size})`}</Text>
        </Pressable>
      </View>

      <TextInput
        style={s.input}
        value={search}
        onChangeText={setSearch}
        placeholder="Search chats"
        autoCapitalize="none"
      />

      {err ? <ErrorState compact title="Couldn’t forward" description={err} /> : null}

      {filtered.length === 0 ? (
        <EmptyState
          fullPage
          title="No targets"
          description="Start a new chat or group before forwarding."
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={c => c.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 24 }}
          renderItem={({ item }) => {
            const on = selected.has(item.id);
            return (
              <Pressable style={[s.row, on && s.rowOn]} onPress={() => toggle(item.id)}>
                <View style={s.avatar}><Text style={s.avatarText}>{item.peerName.slice(0, 1).toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>
                    {item.peerName}
                    {item.type === 'group' && item.memberCount ? `  · ${item.memberCount}` : ''}
                  </Text>
                  <Text style={s.preview} numberOfLines={1}>{item.lastMessageText ?? ''}</Text>
                </View>
                <View style={[s.checkbox, on && s.checkboxOn]}>
                  {on ? <Text style={s.checkmark}>✓</Text> : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bgCanvas },
  header:  { paddingTop: 50, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back:    { fontSize: 24, color: colors.primary, width: 24 },
  title:   { fontSize: 14, fontWeight: '700', color: colors.ink, flex: 1 },
  sendBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.primary },
  sendText:{ color: '#fff', fontWeight: '700', fontSize: 13 },
  input:   { margin: 14, padding: 10, backgroundColor: '#fff', borderRadius: radius.md, fontSize: 14, borderWidth: 1, borderColor: colors.ink200 },
  row:     { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, marginBottom: 6, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.ink100 },
  rowOn:   { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  avatar:  { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700' },
  name:    { fontSize: 14, fontWeight: '700', color: colors.ink },
  preview: { fontSize: 12, color: colors.ink500, marginTop: 2 },
  checkbox:{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.ink300, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
