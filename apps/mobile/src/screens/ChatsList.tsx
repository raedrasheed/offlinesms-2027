import { useEffect, useState } from 'react';
import { FlatList, View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { subscribeConversations, Conversation } from '../lib/chats';
import { colors, radius } from '../theme';

export default function ChatsList({ navigation }: any) {
  const [rows, setRows] = useState<Conversation[] | null>(null);
  useEffect(() => subscribeConversations(setRows), []);
  if (rows === null) return <View style={s.center}><ActivityIndicator color={colors.primary}/></View>;
  if (rows.length === 0) return <View style={s.center}><Text style={s.empty}>No conversations yet</Text></View>;
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: { fontSize: 15, color: colors.ink500 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: radius.md, marginBottom: 4, backgroundColor: '#fff' },
  av: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary },
  name: { fontSize: 14, fontWeight: '700', color: colors.ink },
  preview: { fontSize: 12, color: colors.ink500, marginTop: 2 },
});
