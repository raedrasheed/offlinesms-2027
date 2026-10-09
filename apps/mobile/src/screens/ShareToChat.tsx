// ShareToChat — destination picker for content shared INTO OfflineSMS from
// another app (Android ACTION_SEND / iOS Share Extension, via expo-share-intent).
//
// Tapping a chat hands the shared payload to the normal send flow:
//   • image  → ImagePreview (add a caption, then send through the outbox)
//   • text/url → Conversation with the text pre-filled in the composer
//
// Single-select (share = one destination at a time), mirroring ForwardPicker's
// conversation list.

import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { auth } from '../lib/firebase';
import { useDisplayNames } from '../lib/userProfiles';
import { subscribeConversations, Conversation } from '../lib/conversations';
import { colors, radius } from '../theme';
import { LoadingState, EmptyState } from '../components/state';

type Row = Conversation & { peerName: string };

export default function ShareToChat({ route, navigation }: any) {
  const me = auth.currentUser?.uid;
  const { image, text } = (route.params ?? {}) as {
    image?: { uri: string; mimeType?: string; size?: number };
    text?: string;
  };

  const [rows, setRows]   = useState<Conversation[] | null>(null);
  const { t } = useTranslation();
  const [search, setSearch] = useState('');

  useEffect(() => subscribeConversations(setRows), []);

  // Direct-chat peer names via the shared resolver (one batched read for all
  // peers, cached across screens) — never a uid.
  const peerUidOf = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of rows ?? []) {
      if (c.type !== 'direct' || !c.participantUids?.length) continue;
      const peerUid = c.participantUids.find(u => u !== me);
      if (peerUid) out[c.id] = peerUid;
    }
    return out;
  }, [me, rows]);
  const nameFor = useDisplayNames(Object.values(peerUidOf));

  const enriched: Row[] = useMemo(() => {
    if (!rows) return [];
    return rows
      .filter(c => c.status !== 'disabled')
      .map(c => ({ ...c, peerName: c.type === 'group' ? (c.name || t('names.group')) : nameFor(peerUidOf[c.id]) }));
  }, [rows, peerUidOf, nameFor, t]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return enriched;
    return enriched.filter(c => c.peerName.toLowerCase().includes(q));
  }, [enriched, search]);

  function pick(conversationId: string) {
    if (image?.uri) {
      // Replace so Back from the preview returns to the chat list, not here.
      navigation.replace('ImagePreview', {
        conversationId,
        uri: image.uri,
        mimeType: image.mimeType ?? 'image/jpeg',
        sizeBytes: image.size ?? 0,
        replyTo: null,
      });
    } else {
      navigation.replace('Conversation', { id: conversationId, sharedText: text ?? '' });
    }
  }

  if (rows === null) return <LoadingState fullPage title="Loading chats…" />;

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()}><Text style={s.back}>‹</Text></Pressable>
        <Text style={s.title}>Share to…</Text>
      </View>

      <TextInput style={s.input} value={search} onChangeText={setSearch} placeholder="Search chats" autoCapitalize="none" />

      {filtered.length === 0 ? (
        <EmptyState fullPage title="No chats" description="Start a chat first, then share into it." />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={c => c.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 24 }}
          renderItem={({ item }) => (
            <Pressable style={s.row} onPress={() => pick(item.id)}>
              <View style={s.avatar}><Text style={s.avatarText}>{item.peerName.slice(0, 1).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>
                  {item.peerName}{item.type === 'group' && item.memberCount ? `  · ${item.memberCount}` : ''}
                </Text>
                <Text style={s.preview} numberOfLines={1}>{item.lastMessageText ?? ''}</Text>
              </View>
            </Pressable>
          )}
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
  input:   { margin: 14, padding: 10, backgroundColor: '#fff', borderRadius: radius.md, fontSize: 14, borderWidth: 1, borderColor: colors.ink200 },
  row:     { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, marginBottom: 6, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.ink100 },
  avatar:  { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700' },
  name:    { fontSize: 14, fontWeight: '700', color: colors.ink },
  preview: { fontSize: 12, color: colors.ink500, marginTop: 2 },
});
