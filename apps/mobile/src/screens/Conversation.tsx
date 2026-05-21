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
  Conversation as ConversationDoc,
  Message,
  GroupRole,
} from '../lib/conversations';
import { colors } from '../theme';
import { LoadingState, EmptyState, ErrorState } from '../components/state';

type ComposerGate =
  | { kind: 'allowed' }
  | { kind: 'blocked'; reason: string };

function gateFor(
  convo: ConversationDoc | null | undefined,
  myRole: GroupRole | null,
  isMember: boolean,
): ComposerGate {
  if (!convo) return { kind: 'allowed' };
  if (convo.status === 'disabled') return { kind: 'blocked', reason: 'This conversation is disabled.' };
  if (convo.type !== 'group')      return { kind: 'allowed' };
  if (!isMember)                   return { kind: 'blocked', reason: 'You aren’t a member of this group.' };
  const isPriv = myRole === 'owner' || myRole === 'admin';
  if (convo.status === 'locked' && !isPriv) return { kind: 'blocked', reason: 'Group is locked. Only admins can send.' };
  if (convo.settings?.onlyAdminsCanSend && !isPriv) return { kind: 'blocked', reason: 'Only admins can send messages here.' };
  return { kind: 'allowed' };
}

export default function Conversation({ route, navigation }: any) {
  const { id } = route.params as { id: string };
  const me = auth.currentUser?.uid;

  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [convo, setConvo] = useState<ConversationDoc | null | undefined>(undefined);
  const [peerName, setPeerName] = useState<string>('Chat');
  const [peerTyping, setPeerTyping] = useState(false);
  const [myRole, setMyRole] = useState<GroupRole | null>(null);
  const [memberStatus, setMemberStatus] = useState<'active' | 'removed' | 'left' | 'unknown'>('unknown');

  const listRef = useRef<FlatList<Message>>(null);

  // Conversation doc.
  useEffect(() => {
    if (!id) return;
    return onSnapshot(doc(db, 'conversations', id), snap => {
      setConvo(snap.exists() ? ({ id, ...snap.data() } as ConversationDoc) : null);
    });
  }, [id]);

  // Messages stream.
  useEffect(() => {
    if (!id) return;
    return subscribeMessages(id, rows => {
      setMsgs(rows);
      markRead(id).catch(() => {});
      requestAnimationFrame(() => listRef.current?.scrollToEnd?.({ animated: false }));
    });
  }, [id]);

  // Peer / header info.
  useEffect(() => {
    if (!convo || !me) return;
    if (convo.type === 'group') {
      setPeerName(convo.name ?? 'Group');
      return;
    }
    const peers = (convo.participantUids ?? convo.memberIds ?? []).filter(u => u !== me);
    if (!peers[0]) return;
    const stop = onSnapshot(doc(db, 'users', peers[0]), userSnap => {
      const u = userSnap.data() as { displayName?: string; username?: string } | undefined;
      setPeerName(u?.displayName ?? (u?.username ? `@${u.username}` : 'Chat'));
    });
    return stop;
  }, [convo, me]);

  // Membership (groups).
  useEffect(() => {
    if (!id || !me) return;
    if (convo?.type !== 'group') { setMemberStatus('active'); setMyRole(null); return; }
    return onSnapshot(doc(db, 'conversations', id, 'members', me), snap => {
      if (!snap.exists()) { setMemberStatus('unknown'); setMyRole(null); return; }
      const data = snap.data() as { role?: GroupRole; status?: 'active' | 'removed' | 'left' };
      setMyRole(data.role ?? 'member');
      setMemberStatus(data.status ?? 'active');
    });
  }, [id, me, convo?.type]);

  // Typing indicator.
  useEffect(() => {
    if (!id) return;
    return subscribeTyping(id, rows => setPeerTyping(rows.length > 0));
  }, [id]);

  // Outbound typing.
  useEffect(() => {
    if (!id) return;
    if (!draft) { setTyping(id, false).catch(() => {}); return; }
    setTyping(id, true).catch(() => {});
    const handle = setTimeout(() => setTyping(id, false).catch(() => {}), 3500);
    return () => clearTimeout(handle);
  }, [draft, id]);

  const gate = useMemo(
    () => gateFor(convo, myRole, memberStatus === 'active' || memberStatus === 'unknown'),
    [convo, myRole, memberStatus],
  );

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    if (gate.kind !== 'allowed') return;
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

  const isGroup = convo?.type === 'group';
  const headerSubtitle = useMemo(() => {
    if (peerTyping) return 'typing…';
    if (!isGroup) return null;
    return convo?.memberCount ? `${convo.memberCount} members${convo?.status === 'locked' ? ' · locked' : ''}` : null;
  }, [peerTyping, isGroup, convo?.memberCount, convo?.status]);

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
        renderItem={({ item, index }) => {
          const mine = item.senderUid === me || (item as any).senderId === me;
          const previous = index > 0 ? msgs[index - 1] : null;
          const showSender = isGroup && !mine && (!previous || previous.senderUid !== item.senderUid);
          return (
            <View>
              {showSender ? (
                <Text style={s.senderLabel}>{item.senderDisplayName ?? item.senderUid.slice(0, 6)}</Text>
              ) : null}
              <View style={[s.bubble, mine ? s.sent : s.recv]}>
                <Text style={[s.bubbleText, mine && { color: '#fff' }]}>{item.text}</Text>
              </View>
            </View>
          );
        }}
      />
    );
  }, [msgs, me, isGroup]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.root}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()}><Text style={s.back}>‹</Text></Pressable>
        <Pressable
          style={{ flex: 1 }}
          onPress={() => { if (isGroup) navigation.navigate('GroupInfo', { id }); }}
        >
          <Text style={s.title} numberOfLines={1}>{peerName}</Text>
          {headerSubtitle ? <Text style={s.subtitle}>{headerSubtitle}</Text> : null}
        </Pressable>
      </View>

      {body}

      {err ? <ErrorState compact title="Couldn’t send" description={err} /> : null}

      {gate.kind === 'blocked' ? (
        <View style={s.gate}>
          <Text style={s.gateText}>{gate.reason}</Text>
        </View>
      ) : (
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
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:     { flex: 1, backgroundColor: colors.surface2 },
  header:   { paddingTop: 50, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back:     { fontSize: 24, color: colors.primary },
  title:    { fontSize: 15, fontWeight: '700', color: colors.ink },
  subtitle: { fontSize: 11, color: colors.primary, marginTop: 2 },
  senderLabel: { fontSize: 11, fontWeight: '700', color: colors.ink500, marginLeft: 2, marginTop: 4, marginBottom: 2 },
  bubble:   { maxWidth: '78%', padding: 10, borderRadius: 16 },
  sent:     { alignSelf: 'flex-end', backgroundColor: colors.primary, borderBottomRightRadius: 6 },
  recv:     { alignSelf: 'flex-start', backgroundColor: '#fff', borderBottomLeftRadius: 6, borderWidth: 1, borderColor: colors.ink100 },
  bubbleText:{ fontSize: 14, color: colors.ink, lineHeight: 20 },
  composer: { padding: 12, paddingBottom: 24, flexDirection: 'row', gap: 8, alignItems: 'flex-end', backgroundColor: colors.surface2 },
  input:    { flex: 1, minHeight: 40, maxHeight: 120, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fff', borderRadius: 22, borderWidth: 1, borderColor: colors.ink100, fontSize: 14 },
  sendBtn:  { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  gate:     { padding: 16, paddingBottom: 28, backgroundColor: colors.surface2, borderTopWidth: 1, borderColor: colors.ink100 },
  gateText: { fontSize: 12, color: colors.ink500, textAlign: 'center' },
});
