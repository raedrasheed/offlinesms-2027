import { useEffect, useState } from 'react';
import { FlatList, View, Text, Pressable, StyleSheet } from 'react-native';
import { subscribeConversations, Conversation } from '../lib/chats';
import { colors, radius } from '../theme';
import { LoadingState, EmptyState } from '../components/state';

export default function ChatsList({ navigation }: any) {
  const [rows, setRows] = useState<Conversation[] | null>(null);
  useEffect(() => subscribeConversations(setRows), []);
  if (rows === null) return <LoadingState fullPage title="Loading chats…" />;
  if (rows.length === 0) {
    return (
      <EmptyState
        fullPage
        title="No conversations yet"
        description="When you start or receive a chat, it will appear here."
      />
    );
  }
  return (
    <FlatList data={rows} keyExtractor={r => r.id} contentContainerStyle={{ padding: 12 }}
      renderItem={({ item }) => (
        <Pressable style={s.row} onPress={() => navigation.navigate('Conversation', { id: item.id })}>
          <View style={s.av}/>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{item.name ?? 'Unnamed'}</Text>
            <Text style={s.preview} numberOfLines={1}>{item.lastMessageText ?? ''}</Text>
          </View>
        </Pressable>
      )}/>
  );
}
const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: radius.md, marginBottom: 4, backgroundColor: '#fff' },
  av: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary },
  name: { fontSize: 14, fontWeight: '700', color: colors.ink },
  preview: { fontSize: 12, color: colors.ink500, marginTop: 2 },
});
