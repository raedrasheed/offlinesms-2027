import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList, View, Text, TextInput, Pressable, StyleSheet, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import {
  subscribeMessages,
  subscribeTyping,
  subscribeUserState,
  sendTextMessage,
  markRead,
  markReceipt,
  setTyping,
  editMessage,
  pinMessage,
  Conversation as ConversationDoc,
  Message,
  GroupRole,
  ReplyTo,
  UserState,
} from '../lib/conversations';
import { MessageBubble } from '../components/MessageBubble';
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

function buildPreview(text: string): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 80 ? t.slice(0, 79) + '…' : t;
}

export default function Conversation({ route, navigation }: any) {
  const { id } = route.params as { id: string };
  const me = auth.currentUser?.uid ?? '';

  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [convo, setConvo] = useState<ConversationDoc | null | undefined>(undefined);
  const [peerName, setPeerName] = useState<string>('Chat');
  const [peerTyping, setPeerTyping] = useState(false);
  const [myRole, setMyRole] = useState<GroupRole | null>(null);
  const [memberStatus, setMemberStatus] = useState<'active' | 'removed' | 'left' | 'unknown'>('unknown');
  const [userState, setUserState] = useState<UserState | null>(null);

  const [replyTo, setReplyTo] = useState<ReplyTo | null>(null);
  const [editing, setEditing] = useState<{ messageId: string; originalText: string } | null>(null);

  const listRef = useRef<FlatList<Message>>(null);

  // Conversation doc.
  useEffect(() => {
    if (!id) return;
    return onSnapshot(doc(db, 'conversations', id), snap => {
      setConvo(snap.exists() ? ({ id, ...snap.data() } as ConversationDoc) : null);
    });
  }, [id]);

  // Messages.
  useEffect(() => {
    if (!id) return;
    return subscribeMessages(id, rows => {
      setMsgs(rows);
      markRead(id).catch(() => {});
      // Phase 7: emit receipts for every visible message not authored
      // by the caller. The lib dedupes (messageId, status) so this
      // safely re-runs on every snapshot.
      for (const m of rows) {
        if (m.senderUid === me || (m as any).senderId === me) continue;
        if (m.deletedForEveryone) continue;
        markReceipt(id, m.id, 'delivered');
        markReceipt(id, m.id, 'read');
      }
      requestAnimationFrame(() => listRef.current?.scrollToEnd?.({ animated: false }));
    });
  }, [id, me]);

  // userState (drives starred + deletedForMe filtering).
  useEffect(() => {
    if (!id) return;
    return subscribeUserState(id, setUserState);
  }, [id]);

  // Peer name (direct chats) / group header.
  useEffect(() => {
    if (!convo || !me) return;
    if (convo.type === 'group') { setPeerName(convo.name ?? 'Group'); return; }
    const peers = (convo.participantUids ?? convo.memberIds ?? []).filter(u => u !== me);
    if (!peers[0]) return;
    return onSnapshot(doc(db, 'users', peers[0]), userSnap => {
      const u = userSnap.data() as { displayName?: string; username?: string } | undefined;
      setPeerName(u?.displayName ?? (u?.username ? `@${u.username}` : 'Chat'));
    });
  }, [convo, me]);

  // Membership for groups (drives role + composer gate).
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

  // Outbound typing (only when not editing — editing isn't a send).
  useEffect(() => {
    if (!id || editing) return;
    if (!draft) { setTyping(id, false).catch(() => {}); return; }
    setTyping(id, true).catch(() => {});
    const handle = setTimeout(() => setTyping(id, false).catch(() => {}), 3500);
    return () => clearTimeout(handle);
  }, [draft, id, editing]);

  const gate = useMemo(
    () => gateFor(convo, myRole, memberStatus === 'active' || memberStatus === 'unknown'),
    [convo, myRole, memberStatus],
  );

  const isGroup = convo?.type === 'group';
  const myRoleIsAdmin = myRole === 'owner' || myRole === 'admin';
  const starred = useMemo(() => new Set(userState?.starredMessageIds ?? []), [userState]);
  const deletedForMe = useMemo(() => new Set(userState?.deletedForMeMessageIds ?? []), [userState]);

  // Apply local hide.
  const visibleMsgs = useMemo(() => {
    if (!msgs) return null;
    return msgs.filter(m => !deletedForMe.has(m.id));
  }, [msgs, deletedForMe]);

  function jumpTo(messageId: string) {
    if (!visibleMsgs) return;
    const idx = visibleMsgs.findIndex(m => m.id === messageId);
    if (idx >= 0) listRef.current?.scrollToIndex?.({ index: idx, animated: true, viewPosition: 0.3 });
  }

  function startReply(m: Message) {
    if (m.deletedForEveryone) return;
    setEditing(null);
    setReplyTo({
      messageId:         m.id,
      senderUid:         m.senderUid,
      senderDisplayName: m.senderDisplayName ?? m.senderUid.slice(0, 6),
      preview:           buildPreview(m.text ?? ''),
      type:              'text',
      createdAt:         m.createdAt,
    });
  }
  function startEdit(m: Message) {
    setReplyTo(null);
    setEditing({ messageId: m.id, originalText: m.text ?? '' });
    setDraft(m.text ?? '');
  }
  function cancelEdit() {
    setEditing(null);
    setDraft('');
  }
  function startForward(m: Message) {
    navigation.navigate('ForwardPicker', {
      sourceConversationId: id,
      messageIds: [m.id],
    });
  }
  function openInfo(m: Message) {
    navigation.navigate('MessageInfo', { id, messageId: m.id });
  }
  async function unpin() {
    const messageId = convo?.pinnedMessage?.messageId;
    if (!messageId) return;
    try { await pinMessage(id, messageId, false); }
    catch (e: any) { Alert.alert('Couldn’t unpin', e?.message ?? 'try-again'); }
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    if (gate.kind !== 'allowed' && !editing) return;
    setBusy(true); setErr(null);
    try {
      if (editing) {
        await editMessage(id, editing.messageId, text);
        cancelEdit();
      } else {
        await sendTextMessage(id, text, replyTo);
        setReplyTo(null);
        setDraft('');
        setTyping(id, false).catch(() => {});
      }
    } catch (e: any) {
      setErr(e?.message ?? 'send-failed');
    } finally {
      setBusy(false);
    }
  }

  const headerSubtitle = useMemo(() => {
    if (peerTyping) return 'typing…';
    if (!isGroup) return null;
    return convo?.memberCount ? `${convo.memberCount} members${convo?.status === 'locked' ? ' · locked' : ''}` : null;
  }, [peerTyping, isGroup, convo?.memberCount, convo?.status]);

  const body = useMemo(() => {
    if (visibleMsgs === null) return <LoadingState fullPage title="Loading messages…" />;
    if (visibleMsgs.length === 0) return (
      <EmptyState
        fullPage
        title="Say hello"
        description="Send the first message to start the conversation."
      />
    );
    return (
      <FlatList
        ref={listRef}
        data={visibleMsgs}
        keyExtractor={m => m.id}
        contentContainerStyle={{ padding: 12, gap: 4 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd?.({ animated: false })}
        renderItem={({ item, index }) => {
          const mine = item.senderUid === me || (item as any).senderId === me;
          const previous = index > 0 ? visibleMsgs[index - 1] : null;
          const showSender = isGroup && !mine && (!previous || previous.senderUid !== item.senderUid);
          return (
            <MessageBubble
              message={item}
              showSender={showSender}
              context={{
                conversationId: id,
                isGroup:        isGroup,
                isMyMessage:    mine,
                myRoleIsAdmin,
                isStarred:      starred.has(item.id),
                isPinned:       (item.pinnedAt != null) || convo?.pinnedMessage?.messageId === item.id,
                myUid:          me,
              }}
              onReply={startReply}
              onEditStart={startEdit}
              onForward={startForward}
              onJumpTo={jumpTo}
              onInfo={openInfo}
            />
          );
        }}
      />
    );
  }, [visibleMsgs, me, isGroup, id, myRoleIsAdmin, starred, convo?.pinnedMessage]);

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

      {convo?.pinnedMessage ? (
        <Pressable style={s.pinBanner} onPress={() => jumpTo(convo.pinnedMessage!.messageId)}>
          <Text style={s.pinIcon}>📌</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.pinTitle} numberOfLines={1}>Pinned message</Text>
            <Text style={s.pinPreview} numberOfLines={1}>{convo.pinnedMessage.preview}</Text>
          </View>
          {(!isGroup || myRoleIsAdmin) ? (
            <Pressable onPress={unpin}><Text style={s.pinClose}>×</Text></Pressable>
          ) : null}
        </Pressable>
      ) : null}

      {body}

      {err ? <ErrorState compact title="Couldn’t send" description={err} /> : null}

      {gate.kind === 'blocked' && !editing ? (
        <View style={s.gate}>
          <Text style={s.gateText}>{gate.reason}</Text>
        </View>
      ) : (
        <View>
          {editing ? (
            <View style={s.composerPreview}>
              <View style={{ flex: 1 }}>
                <Text style={s.composerPreviewTitle}>Editing message</Text>
                <Text style={s.composerPreviewBody} numberOfLines={1}>{editing.originalText}</Text>
              </View>
              <Pressable onPress={cancelEdit}><Text style={s.composerPreviewClose}>×</Text></Pressable>
            </View>
          ) : replyTo ? (
            <View style={s.composerPreview}>
              <View style={{ flex: 1 }}>
                <Text style={s.composerPreviewTitle}>Replying to {replyTo.senderDisplayName}</Text>
                <Text style={s.composerPreviewBody} numberOfLines={1}>{replyTo.preview}</Text>
              </View>
              <Pressable onPress={() => setReplyTo(null)}><Text style={s.composerPreviewClose}>×</Text></Pressable>
            </View>
          ) : null}
          <View style={s.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={editing ? 'Edit message' : 'Message'}
              style={s.input}
              multiline
              maxLength={4000}
            />
            <Pressable style={[s.sendBtn, (!draft.trim() || busy) && { opacity: 0.4 }]} onPress={send} disabled={!draft.trim() || busy}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>{editing ? '✓' : '↑'}</Text>
            </Pressable>
          </View>
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
  pinBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#FEF3C7', borderBottomWidth: 1, borderColor: '#F59E0B' },
  pinIcon:   { fontSize: 16 },
  pinTitle:  { fontSize: 11, fontWeight: '700', color: '#A16207' },
  pinPreview:{ fontSize: 12, color: colors.ink, marginTop: 2 },
  pinClose:  { fontSize: 18, color: '#A16207', fontWeight: '700', paddingHorizontal: 4 },
  composerPreview: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, backgroundColor: '#fff', borderTopWidth: 1, borderColor: colors.ink100 },
  composerPreviewTitle: { fontSize: 11, fontWeight: '700', color: colors.primaryDark },
  composerPreviewBody:  { fontSize: 12, color: colors.ink, marginTop: 2 },
  composerPreviewClose: { fontSize: 18, color: colors.ink500, fontWeight: '700', paddingHorizontal: 6 },
  composer: { padding: 12, paddingBottom: 24, flexDirection: 'row', gap: 8, alignItems: 'flex-end', backgroundColor: colors.surface2 },
  input:    { flex: 1, minHeight: 40, maxHeight: 120, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fff', borderRadius: 22, borderWidth: 1, borderColor: colors.ink100, fontSize: 14 },
  sendBtn:  { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  gate:     { padding: 16, paddingBottom: 28, backgroundColor: colors.surface2, borderTopWidth: 1, borderColor: colors.ink100 },
  gateText: { fontSize: 12, color: colors.ink500, textAlign: 'center' },
});
