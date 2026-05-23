import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList, View, Text, TextInput, Pressable, StyleSheet, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
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
import { Ionicons } from '@expo/vector-icons';
import { MessageBubble } from '../components/MessageBubble';
import { useTheme } from '../context/ThemeContext';
import { isRTL } from '../i18n';
import { LoadingState, EmptyState, ErrorState } from '../components/state';
import { avatarColor, initials } from '../lib/avatar';

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
  if (!isMember)                   return { kind: 'blocked', reason: "You aren't a member of this group." };
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
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { id } = route.params as { id: string };
  const me = auth.currentUser?.uid ?? '';

  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [convo, setConvo] = useState<ConversationDoc | null | undefined>(undefined);
  const [peerName, setPeerName] = useState<string>('Chat');
  const [peerUsername, setPeerUsername] = useState<string | null>(null);
  const [peerUid, setPeerUid] = useState<string | null>(null);
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
    setPeerUid(peers[0]);
    return onSnapshot(doc(db, 'users', peers[0]), userSnap => {
      const u = userSnap.data() as { displayName?: string; username?: string } | undefined;
      setPeerName(u?.displayName ?? (u?.username ? `@${u.username}` : 'Chat'));
      setPeerUsername(u?.username ?? null);
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
    catch (e: any) { Alert.alert("Couldn't unpin", e?.message ?? 'try-again'); }
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
      <View style={s.emptyConvo}>
        <View style={[s.emptyAvatar, { backgroundColor: avatarColor(peerUid ?? peerName) }]}>
          <Text style={s.emptyAvatarText}>{initials(peerName)}</Text>
        </View>
        <Text style={s.emptyName}>{peerName}</Text>
        {peerUsername ? <Text style={s.emptyHandle}>@{peerUsername}</Text> : null}
        <View style={s.e2eNotice}>
          <Ionicons name="lock-closed" size={12} color={colors.text.muted} />
          <Text style={s.e2eText}>Messages here are end-to-end encrypted</Text>
        </View>
        <Text style={s.emptyNudge}>Say hi — your first message will start the chat.</Text>
      </View>
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
              onSendViaSms={msg => navigation.navigate('SmsEscalation', {
                conversationId: id,
                messageId:      msg.id,
                messageText:    msg.text,
              })}
            />
          );
        }}
      />
    );
  }, [visibleMsgs, me, isGroup, id, myRoleIsAdmin, starred, convo?.pinnedMessage]);

  const s = buildStyles(colors, isRTL);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.root}>
      <View style={s.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Text style={s.back}>{isRTL ? '›' : '‹'}</Text>
        </Pressable>
        <Pressable
          style={{ flex: 1 }}
          onPress={() => { if (isGroup) navigation.navigate('GroupInfo', { id }); }}
          accessible={true}
          accessibilityRole={isGroup ? 'button' : 'text'}
          accessibilityLabel={isGroup ? `${peerName}, ${t('group.info')}` : peerName}
        >
          <Text style={s.title} numberOfLines={1}>{peerName}</Text>
          {headerSubtitle ? <Text style={s.subtitle}>{headerSubtitle}</Text> : null}
        </Pressable>
      </View>

      {convo?.pinnedMessage ? (
        <Pressable
          style={s.pinBanner}
          onPress={() => jumpTo(convo.pinnedMessage!.messageId)}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`${t('messageActions.pinnedTitle')}: ${convo.pinnedMessage.preview}`}
        >
          <Text style={s.pinIcon} accessibilityElementsHidden>📌</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.pinTitle} numberOfLines={1}>{t('messageActions.pinnedTitle')}</Text>
            <Text style={s.pinPreview} numberOfLines={1}>{convo.pinnedMessage.preview}</Text>
          </View>
          {(!isGroup || myRoleIsAdmin) ? (
            <Pressable
              onPress={unpin}
              accessibilityRole="button"
              accessibilityLabel={t('messageActions.unpin')}
            >
              <Text style={s.pinClose}>×</Text>
            </Pressable>
          ) : null}
        </Pressable>
      ) : null}

      {body}

      {err ? <ErrorState compact title="Couldn't send" description={err} /> : null}

      {gate.kind === 'blocked' && !editing ? (
        <View style={s.gate}>
          <Text style={s.gateText}>{gate.reason}</Text>
        </View>
      ) : (
        <View>
          {editing ? (
            <View style={s.composerPreview}>
              <View style={{ flex: 1 }}>
                <Text style={s.composerPreviewTitle}>{t('messageActions.editingMessage')}</Text>
                <Text style={s.composerPreviewBody} numberOfLines={1}>{editing.originalText}</Text>
              </View>
              <Pressable
                onPress={cancelEdit}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
              >
                <Text style={s.composerPreviewClose}>×</Text>
              </Pressable>
            </View>
          ) : replyTo ? (
            <View style={s.composerPreview}>
              <View style={{ flex: 1 }}>
                <Text style={s.composerPreviewTitle}>{t('messageActions.replyingTo', { name: replyTo.senderDisplayName })}</Text>
                <Text style={s.composerPreviewBody} numberOfLines={1}>{replyTo.preview}</Text>
              </View>
              <Pressable
                onPress={() => setReplyTo(null)}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
              >
                <Text style={s.composerPreviewClose}>×</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={s.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={editing ? t('messageActions.editingMessage') : t('convo.composerPlaceholder')}
              style={s.input}
              multiline
              maxLength={4000}
              textAlign={isRTL ? 'right' : 'left'}
              accessibilityLabel={t('convo.composerPlaceholder')}
            />
            <Pressable
              style={[s.sendBtn, (!draft.trim() || busy) && { opacity: 0.4 }]}
              onPress={send}
              disabled={!draft.trim() || busy}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={editing ? t('common.save') : t('common.send')}
              accessibilityState={{ disabled: !draft.trim() || busy }}
            >
              <Text style={{ color: colors.action.primaryFg, fontWeight: '700' }}>{editing ? '✓' : '↑'}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function buildStyles(colors: any, rtl: boolean) {
  return StyleSheet.create({
    root:     { flex: 1, backgroundColor: colors.background.subtle },
    emptyConvo:    { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 6 },
    emptyAvatar:   { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    emptyAvatarText:{ color: '#fff', fontSize: 34, fontWeight: '800' },
    emptyName:     { fontSize: 20, fontWeight: '800', color: colors.text.primary, textAlign: 'center' },
    emptyHandle:   { fontSize: 13, color: colors.text.muted, textAlign: 'center' },
    e2eNotice:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.background.subtle, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, marginTop: 16 },
    e2eText:       { fontSize: 12, color: colors.text.muted },
    emptyNudge:    { fontSize: 13, color: colors.text.muted, textAlign: 'center', marginTop: 14, lineHeight: 19 },
    header:   { paddingTop: 50, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.background.surface, flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: colors.border.subtle },
    back:     { fontSize: 24, color: colors.action.primary, minWidth: 32, textAlign: 'center' },
    title:    { fontSize: 15, fontWeight: '700', color: colors.text.primary, textAlign: rtl ? 'right' : 'left' },
    subtitle: { fontSize: 11, color: colors.action.primary, marginTop: 2, textAlign: rtl ? 'right' : 'left' },
    pinBanner: { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#FEF3C7', borderBottomWidth: 1, borderColor: '#F59E0B' },
    pinIcon:   { fontSize: 16 },
    pinTitle:  { fontSize: 11, fontWeight: '700', color: '#A16207', textAlign: rtl ? 'right' : 'left' },
    pinPreview:{ fontSize: 12, color: colors.text.primary, marginTop: 2, textAlign: rtl ? 'right' : 'left' },
    pinClose:  { fontSize: 18, color: '#A16207', fontWeight: '700', paddingHorizontal: 4, minWidth: 32, minHeight: 32, textAlignVertical: 'center', textAlign: 'center' },
    composerPreview: { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 10, padding: 10, backgroundColor: colors.background.surface, borderTopWidth: 1, borderColor: colors.border.subtle },
    composerPreviewTitle: { fontSize: 11, fontWeight: '700', color: colors.action.primary, textAlign: rtl ? 'right' : 'left' },
    composerPreviewBody:  { fontSize: 12, color: colors.text.primary, marginTop: 2, textAlign: rtl ? 'right' : 'left' },
    composerPreviewClose: { fontSize: 18, color: colors.text.muted, fontWeight: '700', paddingHorizontal: 6, minWidth: 36, minHeight: 36, textAlignVertical: 'center', textAlign: 'center' },
    composer: { padding: 12, paddingBottom: 24, flexDirection: rtl ? 'row-reverse' : 'row', gap: 8, alignItems: 'flex-end', backgroundColor: colors.background.subtle },
    input:    { flex: 1, minHeight: 40, maxHeight: 120, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.background.surface, borderRadius: 22, borderWidth: 1, borderColor: colors.border.subtle, fontSize: 14, color: colors.text.primary },
    sendBtn:  { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.action.primary, alignItems: 'center', justifyContent: 'center' },
    gate:     { padding: 16, paddingBottom: 28, backgroundColor: colors.background.subtle, borderTopWidth: 1, borderColor: colors.border.subtle },
    gateText: { fontSize: 12, color: colors.text.muted, textAlign: 'center' },
  });
}
