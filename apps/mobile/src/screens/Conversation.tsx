import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList, View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import {
  subscribeMessages,
  subscribeTyping,
  sendTextMessage,
  markRead,
  setTyping,
  Message,
} from '../lib/conversations';
import { colors } from '../theme';
import { LoadingState, EmptyState, ErrorState } from '../components/state';

export default function Conversation({ route, navigation }: any) {
  const { id } = route.params as { id: string };
  const me = auth.currentUser?.uid;

  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [peerName, setPeerName] = useState<string>('Chat');
  const [peerTyping, setPeerTyping] = useState(false);

  const listRef = useRef<FlatList<Message>>(null);

  // Messages stream.
  useEffect(() => {
    if (!id) return;
    return subscribeMessages(id, rows => {
      setMsgs(rows);
      // Mark-read whenever a new message arrives or list opens.
      markRead(id).catch(() => {});
      // Scroll to bottom on next tick.
      requestAnimationFrame(() => listRef.current?.scrollToEnd?.({ animated: false }));
    });
  }, [id]);

  // Peer name (direct conversations only).
  useEffect(() => {
    if (!id || !me) return;
    const unsub = onSnapshot(doc(db, 'conversations', id), snap => {
      const data = snap.data() as { participantUids?: string[]; memberIds?: string[]; type?: string; name?: string } | undefined;
      if (!data) return;
      if (data.type !== 'direct') { setPeerName(data.name ?? 'Group'); return; }
      const peers = (data.participantUids ?? data.memberIds ?? []).filter(u => u !== me);
      if (!peers[0]) return;
      const stop = onSnapshot(doc(db, 'users', peers[0]), userSnap => {
        const u = userSnap.data() as { displayName?: string; username?: string } | undefined;
        setPeerName(u?.displayName ?? (u?.username ? `@${u.username}` : 'Chat'));
      });
      return stop;
    });
    return unsub;
  }, [id, me]);

  // Typing indicator.
  useEffect(() => {
    if (!id) return;
    return subscribeTyping(id, rows => setPeerTyping(rows.length > 0));
  }, [id]);

  // Outbound typing: emit start/stop based on input.
  useEffect(() => {
    if (!id) return;
    if (!draft) {
      setTyping(id, false).catch(() => {});
      return;
    }
    setTyping(id, true).catch(() => {});
    const handle = setTimeout(() => setTyping(id, false).catch(() => {}), 3500);
    return () => clearTimeout(handle);
  }, [draft, id]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true); setErr(null);
    try {
      await sendTextMessage(id, text);
      setDraft('');
      setTyping(id, false).catch(() => {});
    } catch (e: any) {
      setErr(e?.message ?? 'send-failed');
    } finally {
      setBusy(false);
    }
  }

  const body = useMemo(() => {
    if (msgs === null) return <LoadingState fullPage title="Loading messages…" />;
    if (msgs.length === 0) return (
      <EmptyState
        fullPage
        title="Say hello"
        description="Send the first message to start the conversation."
      />
    );
    return (
      <FlatList
        ref={listRef}
        data={msgs}
        keyExtractor={m => m.id}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd?.({ animated: false })}
        renderItem={({ item }) => {
          const mine = item.senderUid === me || (item as any).senderId === me;
          return (
            <View style={[s.bubble, mine ? s.sent : s.recv]}>
              <Text style={[s.bubbleText, mine && { color: '#fff' }]}>{item.text}</Text>
            </View>
          );
        }}
      />
    );
  }, [msgs, me]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()}><Text style={s.back}>‹</Text></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>{peerName}</Text>
          {peerTyping ? <Text style={s.subtitle}>typing…</Text> : null}
        </View>
      </View>

      {body}

      {err ? <ErrorState compact title="Couldn’t send" description={err} /> : null}

      <View style={s.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          style={s.input}
          multiline
          maxLength={4000}
        />
        <Pressable style={[s.sendBtn, (!draft.trim() || busy) && { opacity: 0.4 }]} onPress={send} disabled={!draft.trim() || busy}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:     { flex: 1, backgroundColor: colors.surface2 },
  header:   { paddingTop: 50, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back:     { fontSize: 24, color: colors.primary },
  title:    { fontSize: 15, fontWeight: '700', color: colors.ink },
  subtitle: { fontSize: 11, color: colors.primary, marginTop: 2 },
  bubble:   { maxWidth: '78%', padding: 10, borderRadius: 16 },
  sent:     { alignSelf: 'flex-end', backgroundColor: colors.primary, borderBottomRightRadius: 6 },
  recv:     { alignSelf: 'flex-start', backgroundColor: '#fff', borderBottomLeftRadius: 6, borderWidth: 1, borderColor: colors.ink100 },
  bubbleText:{ fontSize: 14, color: colors.ink, lineHeight: 20 },
  composer: { padding: 12, paddingBottom: 24, flexDirection: 'row', gap: 8, alignItems: 'flex-end', backgroundColor: colors.surface2 },
  input:    { flex: 1, minHeight: 40, maxHeight: 120, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fff', borderRadius: 22, borderWidth: 1, borderColor: colors.ink100, fontSize: 14 },
  sendBtn:  { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
