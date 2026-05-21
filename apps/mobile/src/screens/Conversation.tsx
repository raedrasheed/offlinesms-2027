import { useEffect, useState } from 'react';
import { FlatList, View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { subscribeMessages, sendText, Message } from '../lib/chats';
import { colors } from '../theme';
import { auth } from '../lib/firebase';

export default function Conversation({ route, navigation }: any) {
  const { id } = route.params;
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const me = auth.currentUser?.uid;
  useEffect(() => id ? subscribeMessages(id, setMsgs) : undefined, [id]);
  async function send() { if (!draft.trim()) return; await sendText(id, draft.trim()); setDraft(''); }
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()}><Text style={s.back}>‹</Text></Pressable>
        <Text style={s.title}>Chat</Text>
      </View>
      <FlatList data={msgs} keyExtractor={m => m.id} contentContainerStyle={{ padding: 12, gap: 8 }}
        renderItem={({ item }) => {
          const mine = item.senderId === me;
          return (
            <View style={[s.bubble, mine ? s.sent : s.recv]}>
              <Text style={[s.bubbleText, mine && { color: '#fff' }]}>{item.text}</Text>
            </View>
          );
        }}/>
      <View style={s.composer}>
        <TextInput value={draft} onChangeText={setDraft} placeholder="Message" style={s.input} multiline />
        <Pressable style={s.sendBtn} onPress={send}><Text style={{ color:'#fff', fontWeight: '700' }}>↑</Text></Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface2 },
  header: { paddingTop: 50, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { fontSize: 24, color: colors.primary },
  title: { fontSize: 14, fontWeight: '700', color: colors.ink },
  bubble: { maxWidth: '78%', padding: 10, borderRadius: 16 },
  sent: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderBottomRightRadius: 6 },
  recv: { alignSelf: 'flex-start', backgroundColor: '#fff', borderBottomLeftRadius: 6, borderWidth: 1, borderColor: colors.ink100 },
  bubbleText: { fontSize: 14, color: colors.ink, lineHeight: 20 },
  composer: { padding: 12, paddingBottom: 24, flexDirection: 'row', gap: 8, alignItems: 'flex-end', backgroundColor: colors.surface2 },
  input: { flex: 1, minHeight: 40, maxHeight: 120, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fff', borderRadius: 22, borderWidth: 1, borderColor: colors.ink100, fontSize: 14 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
