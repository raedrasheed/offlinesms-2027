import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList, View, Text, TextInput, Pressable, StyleSheet, Alert,
  KeyboardAvoidingView, Platform, PanResponder, Image,
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
  subscribeMembers,
  GroupMember,
} from '../lib/conversations';
import type { ReactorInfo } from '../components/ReactionsSheet';
import { useUserProfiles } from '../lib/userProfiles';
import { Ionicons } from '@expo/vector-icons';
import { MessageBubble } from '../components/MessageBubble';
import { useTheme } from '../context/ThemeContext';
import { isRTL } from '../i18n';
import { LoadingState, EmptyState, ErrorState } from '../components/state';
import { avatarColor, initials } from '../lib/avatar';
import { useOffline } from '../context/OfflineContext';
import { OfflineNotice, SyncSuccessChip } from '../components/OfflineBanners';
import { getDraft, setDraft as persistDraft, clearDraft } from '../lib/drafts';
import { useLocalConversation } from '../hooks/useLocalConversation';
import { useMessagePersistence } from '../hooks/useLocalPersistence';
import { queueSendMessage, queueEditMessage, queueMarkReceipt, retryMediaMessage, queueSendVoiceMessage, openLocalDb } from '../localdb';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { AttachmentSheet } from '../components/chat/AttachmentSheet';
import { VoiceRecorderBar } from '../components/chat/VoiceRecorderBar';
import { LockedVoiceRecorderBar } from '../components/chat/LockedVoiceRecorderBar';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { validateMediaMessage, type AttachmentKey } from '../media/mediaValidation';

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
  const { isOffline, enqueue, queuedFor, deliveredFor, deliveredNonce } = useOffline();

  // Phase 22C — local-first conversation (flag-gated). `useLocal` is true only
  // when the flag is on AND the local DB initialised; otherwise the Firestore +
  // OfflineContext path below runs unchanged (including as a fallback).
  const local = useLocalConversation(id, me);
  const useLocal = local.source === 'local';

  // Mirror this conversation's messages into the local SQLite DB while it's open.
  useMessagePersistence(id, me || undefined);

  // Re-read local messages when returning to this screen (e.g. after sending an
  // image from the preview screen) so the optimistic bubble shows immediately.
  const refreshRef = useRef(local.refresh);
  useEffect(() => { refreshRef.current = local.refresh; });
  useEffect(() => navigation.addListener('focus', () => {
    refreshRef.current?.();
    // Land on the latest message whenever the chat is opened/re-focused.
    requestAnimationFrame(() => listRef.current?.scrollToEnd?.({ animated: false }));
  }), [navigation]);

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

  // Messages (Firestore path — skipped when the local DB drives the screen).
  useEffect(() => {
    if (useLocal || !id) return;
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
  }, [id, me, useLocal]);

  // Local-first mode: messages come from the feeder/local DB; still emit
  // read/delivered receipts for incoming messages (callables dedupe server-side).
  useEffect(() => {
    if (!useLocal || !id) return;
    markRead(id).catch(() => {});
    for (const m of local.messages) {
      if (m.senderUid === me) continue;
      if (m.deletedForEveryone) continue;
      void queueMarkReceipt({ conversationId: id, messageId: m.id, status: 'delivered' });
      void queueMarkReceipt({ conversationId: id, messageId: m.id, status: 'read' });
    }
    requestAnimationFrame(() => listRef.current?.scrollToEnd?.({ animated: false }));
  }, [useLocal, id, me, local.messages]);

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

  // Group member names/photos — resolves uids for the reactions breakdown and
  // sender avatars. Uses the membership snapshot first, then the user profile
  // (covers members whose snapshot has no name/photo).
  const [members, setMembers] = useState<GroupMember[]>([]);
  useEffect(() => {
    if (!id || convo?.type !== 'group') { setMembers([]); return; }
    return subscribeMembers(id, setMembers);
  }, [id, convo?.type]);
  const memberUids = useMemo(() => members.map(m => m.uid), [members]);
  const memberProfiles = useUserProfiles(memberUids);
  // Direct-chat peer photo for the header / empty-state avatar.
  const isDirect = convo?.type !== 'group';
  const peerProfiles = useUserProfiles(isDirect && peerUid ? [peerUid] : []);
  const peerPhoto = isDirect && peerUid ? (peerProfiles[peerUid]?.photoURL ?? null) : null;
  const reactorNames = useMemo<Record<string, ReactorInfo>>(() => {
    const map: Record<string, ReactorInfo> = {};
    for (const m of members) {
      const prof = memberProfiles[m.uid];
      map[m.uid] = {
        name: m.displayNameSnapshot || prof?.displayName || m.uid.slice(0, 6),
        photoURL: m.photoURLSnapshot || prof?.photoURL || null,
      };
    }
    return map;
  }, [members, memberProfiles]);

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

  // Restore a saved draft when opening the chat.
  useEffect(() => {
    let on = true;
    getDraft(id).then(text => { if (on && text) setDraft(prev => prev || text); });
    return () => { on = false; };
  }, [id]);

  // Persist the composer draft (debounced) so it survives navigation/restart.
  useEffect(() => {
    if (editing) return;
    const h = setTimeout(() => { persistDraft(id, draft); }, 400);
    return () => clearTimeout(h);
  }, [draft, id, editing]);

  // Post-reconnect "delivered after reconnect" chip.
  const [deliveredChip, setDeliveredChip] = useState(0);
  useEffect(() => {
    const n = deliveredFor(id);
    if (n > 0) {
      setDeliveredChip(n);
      const h = setTimeout(() => setDeliveredChip(0), 5000);
      return () => clearTimeout(h);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveredNonce]);

  const gate = useMemo(
    () => gateFor(convo, myRole, memberStatus === 'active' || memberStatus === 'unknown'),
    [convo, myRole, memberStatus],
  );

  const isGroup = convo?.type === 'group';
  const myRoleIsAdmin = myRole === 'owner' || myRole === 'admin';
  const starred = useMemo(() => new Set(userState?.starredMessageIds ?? []), [userState]);
  const deletedForMe = useMemo(() => new Set(userState?.deletedForMeMessageIds ?? []), [userState]);

  // Effective message source: local DB when local-first is active, else the
  // Firestore-fed `msgs`. (null = still loading → renders the loader.)
  const effectiveMsgs: Message[] | null = useLocal
    ? (local.loading && local.messages.length === 0 ? null : local.messages)
    : msgs;

  // Apply local hide.
  const visibleMsgs = useMemo(() => {
    if (!effectiveMsgs) return null;
    return effectiveMsgs.filter(m => !deletedForMe.has(m.id));
  }, [effectiveMsgs, deletedForMe]);

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
    navigation.navigate('MessageInfo', {
      id,
      messageId:   m.id,
      messageText: m.deletedForEveryone ? 'This message was deleted.' : (m.text ?? ''),
      createdAtMs: m.createdAt?.toMillis?.() ?? null,
      isGroup,
      groupName:   isGroup ? peerName : null,
      memberCount: convo?.memberCount ?? null,
      mediaUploadError: m.type !== 'text' && m.media?.uploadStatus === 'failed'
        ? { code: m.errorCode ?? null, message: m.errorMessage ?? null }
        : null,
    });
  }
  async function unpin() {
    const messageId = convo?.pinnedMessage?.messageId;
    if (!messageId) return;
    try { await pinMessage(id, messageId, false); }
    catch (e: any) { Alert.alert("Couldn't unpin", e?.message ?? 'try-again'); }
  }

  // Phase 23 — attachment sheet + image picking.
  const [attachOpen, setAttachOpen] = useState(false);

  async function handleAsset(res: ImagePicker.ImagePickerResult) {
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    let size = a.fileSize ?? 0;
    if (!size) {
      try { const info = await FileSystem.getInfoAsync(a.uri); size = (info as any).size ?? 0; } catch { /* best-effort */ }
    }
    navigation.navigate('ImagePreview', {
      conversationId: id,
      uri: a.uri,
      width: a.width,
      height: a.height,
      mimeType: a.mimeType ?? 'image/jpeg',
      sizeBytes: size,
      replyTo: replyTo ?? null,
    });
    setReplyTo(null);
  }

  async function onAttachSelect(key: AttachmentKey) {
    if (key === 'photos') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert(t('media.photosPermissionTitle'), t('media.photosPermissionMessage')); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
      await handleAsset(res);
    } else if (key === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert(t('media.cameraPermissionTitle'), t('media.cameraPermissionMessage')); return; }
      const res = await ImagePicker.launchCameraAsync({ quality: 0.8 });
      await handleAsset(res);
    }
  }

  const openImage = (uri: string) => navigation.navigate('ImageViewer', { uri });
  const retryMedia = (msg: Message) => { void retryMediaMessage(msg.id); };

  function confirmClearChat() {
    Alert.alert(
      t('chats.clearChatTitle'),
      t('chats.clearChatMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('chats.clearChat'), style: 'destructive', onPress: () => { void local.clear(); setMsgs([]); } },
      ],
    );
  }
  const onPlayedVoice = (msg: Message) => {
    if (msg.senderUid !== me) void queueMarkReceipt({ conversationId: id, messageId: msg.id, status: 'played' });
  };

  // Phase 23 — voice recording (hold mic → record, slide left → cancel, swipe up → lock).
  const recorder = useVoiceRecorder();
  const modeRef = useRef(recorder.mode);
  useEffect(() => { modeRef.current = recorder.mode; }, [recorder.mode]);
  const cancelArmedRef = useRef(false);
  const [cancelArmed, setCancelArmed] = useState(false);
  // Refs so the PanResponder (created once) reads current values.
  const draftEmptyRef = useRef(true);
  const editingRef = useRef(false);
  const replyToRef = useRef<ReplyTo | null>(null);
  useEffect(() => { draftEmptyRef.current = draft.trim() === ''; }, [draft]);
  useEffect(() => { editingRef.current = !!editing; }, [editing]);
  useEffect(() => { replyToRef.current = replyTo; }, [replyTo]);

  async function sendVoice(res: Awaited<ReturnType<typeof recorder.stop>>) {
    if (!res) return;
    const check = validateMediaMessage({ mediaType: 'voice', mimeType: res.mimeType, sizeBytes: res.sizeBytes, durationMs: res.durationMs });
    if (!check.ok) {
      if (check.reason === 'too-short') Alert.alert(t('media.recordingTooShort'));
      else Alert.alert(t('media.uploadFailed'));
      return;
    }
    try {
      await openLocalDb(me);
      await queueSendVoiceMessage({
        conversationId: id,
        senderUid: me,
        localUri: res.uri,
        mimeType: res.mimeType,
        sizeBytes: res.sizeBytes,
        durationMs: res.durationMs,
        waveform: res.waveform,
        replyTo: replyToRef.current ?? null,
      });
      setReplyTo(null);
      local.refresh();
    } catch (e: any) {
      Alert.alert(t('media.uploadFailed'), e?.message ?? 'try-again');
    }
  }

  const micPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => draftEmptyRef.current && !editingRef.current,
      onStartShouldSetPanResponderCapture: () => draftEmptyRef.current && !editingRef.current,
      onMoveShouldSetPanResponder: () => modeRef.current !== 'idle',
      onMoveShouldSetPanResponderCapture: () => modeRef.current !== 'idle',
      // Don't let the message list steal the swipe-up-to-lock vertical drag.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => {
        void (async () => {
          const ok = await recorder.start();
          if (!ok) Alert.alert(t('media.microphonePermissionTitle'), t('media.microphonePermissionMessage'));
        })();
      },
      onPanResponderMove: (_evt, g) => {
        if (modeRef.current !== 'recording') return;
        if (g.dy < -70) recorder.lock();
        const armed = g.dx < -80;
        if (armed !== cancelArmedRef.current) { cancelArmedRef.current = armed; setCancelArmed(armed); }
      },
      onPanResponderRelease: () => {
        void (async () => {
          if (modeRef.current === 'locked') return; // locked → use bar buttons
          if (cancelArmedRef.current) { cancelArmedRef.current = false; setCancelArmed(false); await recorder.cancel(); return; }
          const res = await recorder.stop();
          await sendVoice(res);
        })();
      },
      onPanResponderTerminate: () => { if (modeRef.current !== 'locked') void recorder.cancel(); },
    }),
  ).current;

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    if (gate.kind !== 'allowed' && !editing) return;
    setBusy(true); setErr(null);
    try {
      if (editing) {
        if (useLocal) await queueEditMessage({ conversationId: id, messageId: editing.messageId, text });
        else await editMessage(id, editing.messageId, text);
        cancelEdit();
      } else if (useLocal) {
        // Local-first: write an optimistic local message + idempotent outbox
        // item; the sync engine delivers it (online or on reconnect) and
        // reconciles to the server id without duplicating on retry.
        await queueSendMessage({
          conversationId: id,
          senderUid: me,
          text,
          replyTo: replyTo ? {
            messageId: replyTo.messageId,
            senderUid: replyTo.senderUid,
            senderDisplayName: replyTo.senderDisplayName,
            preview: replyTo.preview,
          } : null,
        });
        local.refresh();
        setReplyTo(null);
        setDraft('');
        clearDraft(id);
        setTyping(id, false).catch(() => {});
      } else if (isOffline) {
        // Offline-first: persist locally and deliver on reconnect.
        await enqueue({ conversationId: id, conversationType: isGroup ? 'group' : 'direct', text, replyTo: replyTo ?? null });
        setReplyTo(null);
        setDraft('');
        clearDraft(id);
        setTyping(id, false).catch(() => {});
      } else {
        await sendTextMessage(id, text, replyTo);
        setReplyTo(null);
        setDraft('');
        clearDraft(id);
        setTyping(id, false).catch(() => {});
      }
    } catch (e: any) {
      setErr(e?.message ?? 'send-failed');
    } finally {
      setBusy(false);
    }
  }

  const s = buildStyles(colors, isRTL);

  const headerSubtitle = useMemo(() => {
    if (peerTyping) return 'typing…';
    if (!isGroup) return 'Online';
    return convo?.memberCount ? `${convo.memberCount} members${convo?.status === 'locked' ? ' · locked' : ''}` : null;
  }, [peerTyping, isGroup, convo?.memberCount, convo?.status]);

  const queued = queuedFor(id);
  const body = useMemo(() => {
    if (visibleMsgs === null) return <LoadingState fullPage title="Loading messages…" />;

    const queuedItems = queued.map(q => ({
      id:             q.localQueueId,
      conversationId: id,
      senderUid:      me,
      type:           'text' as const,
      text:           q.text,
      createdAt:      { toMillis: () => q.createdAt },
      __pending:      q.status as 'queued' | 'syncing' | 'failed',
    }));

    if (visibleMsgs.length === 0 && queuedItems.length === 0) return (
      <View style={s.emptyConvo}>
        {peerPhoto ? (
          <Image source={{ uri: peerPhoto }} style={s.emptyAvatar} />
        ) : (
          <View style={[s.emptyAvatar, { backgroundColor: avatarColor(peerUid ?? peerName) }]}>
            <Text style={s.emptyAvatarText}>{initials(peerName)}</Text>
          </View>
        )}
        <Text style={s.emptyName}>{peerName}</Text>
        {peerUsername ? <Text style={s.emptyHandle}>@{peerUsername}</Text> : null}
        <View style={s.e2eNotice}>
          <Ionicons name="lock-closed" size={12} color="#92400E" />
          <Text style={s.e2eText}>Messages here are end-to-end encrypted</Text>
        </View>
        <Text style={s.emptyNudge}>Say hi — your first message will start the chat.</Text>
      </View>
    );

    const data: any[] = [...visibleMsgs, ...queuedItems];
    return (
      <FlatList
        ref={listRef}
        style={s.msgList}
        data={data}
        keyExtractor={(m: any) => m.id}
        contentContainerStyle={{ padding: 12, gap: 4 }}
        ListHeaderComponent={
          <View style={s.listHeader}>
            <View style={s.datePill}><Text style={s.datePillText}>Today</Text></View>
            <View style={s.e2eBanner}>
              <Ionicons name="lock-closed" size={12} color="#92400E" />
              <Text style={s.e2eBannerText}>Messages and calls are end-to-end encrypted</Text>
            </View>
          </View>
        }
        onContentSizeChange={() => listRef.current?.scrollToEnd?.({ animated: false })}
        renderItem={({ item, index }) => {
          if (item.__pending) {
            return (
              <MessageBubble
                message={item}
                pending={item.__pending}
                showSender={false}
                context={{ conversationId: id, isGroup, isMyMessage: true, myRoleIsAdmin, isStarred: false, isPinned: false, myUid: me, memberCount: convo?.memberCount, localFirst: useLocal }}
                onReply={() => {}}
                onEditStart={() => {}}
                onForward={() => {}}
                onJumpTo={() => {}}
                onInfo={() => {}}
              />
            );
          }
          const mine = item.senderUid === me || (item as any).senderId === me;
          const previous = index > 0 ? data[index - 1] : null;
          const showSender = isGroup && !mine && (!previous || previous.__pending || previous.senderUid !== item.senderUid);
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
                memberCount:    convo?.memberCount,
                reactorNames,
                localFirst:     useLocal,
              }}
              onReply={startReply}
              onEditStart={startEdit}
              onForward={startForward}
              onJumpTo={jumpTo}
              onInfo={openInfo}
              onOpenImage={openImage}
              onRetryMedia={retryMedia}
              onPlayedVoice={onPlayedVoice}
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
  }, [visibleMsgs, queued, me, isGroup, id, myRoleIsAdmin, starred, convo?.pinnedMessage, convo?.memberCount, reactorNames]);

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
          style={s.headerInfo}
          onPress={() => { if (isGroup) navigation.navigate('GroupInfo', { id }); }}
          accessible={true}
          accessibilityRole={isGroup ? 'button' : 'text'}
          accessibilityLabel={isGroup ? `${peerName}, ${t('group.info')}` : peerName}
        >
          <View style={s.headerAvatarWrap}>
            {peerPhoto ? (
              <Image source={{ uri: peerPhoto }} style={s.headerAvatar} />
            ) : (
              <View style={[s.headerAvatar, { backgroundColor: avatarColor(peerUid ?? peerName) }]}>
                <Text style={s.headerAvatarText}>{initials(peerName)}</Text>
              </View>
            )}
            {!isGroup ? <View style={s.onlineDot} /> : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>{peerName}</Text>
            {headerSubtitle ? <Text style={s.subtitle}>{headerSubtitle}</Text> : null}
          </View>
        </Pressable>
        <Pressable
          onPress={confirmClearChat}
          hitSlop={10}
          style={s.headerMenuBtn}
          accessibilityRole="button"
          accessibilityLabel={t('chats.clearChat')}
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.text.muted} />
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

      {deliveredChip > 0 ? <SyncSuccessChip count={deliveredChip} /> : null}
      {isOffline ? <OfflineNotice /> : null}

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
            {recorder.mode === 'locked' ? (
              <LockedVoiceRecorderBar
                elapsedMs={recorder.elapsedMs}
                bars={recorder.bars}
                paused={recorder.paused}
                onTrash={() => { void recorder.cancel(); }}
                onTogglePause={() => { void recorder.togglePause(); }}
                onSend={() => { void (async () => { const res = await recorder.stop(); await sendVoice(res); })(); }}
              />
            ) : recorder.mode === 'recording' ? (
              <>
                <VoiceRecorderBar elapsedMs={recorder.elapsedMs} bars={recorder.bars} cancelArmed={cancelArmed} />
                <View style={s.micWrap}>
                  <View style={s.lockPill}>
                    <Ionicons name="lock-closed" size={16} color={colors.text.muted} />
                    <Ionicons name="chevron-up" size={14} color={colors.text.muted} />
                  </View>
                  <View style={[s.sendBtn, s.micRecording]} {...micPan.panHandlers}>
                    <Ionicons name="mic" size={26} color={colors.action.primaryFg} />
                  </View>
                </View>
              </>
            ) : (
              <>
                {!editing ? (
                  <Pressable
                    style={s.attachBtn}
                    onPress={() => setAttachOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel={t('media.attach')}
                  >
                    <Ionicons name="add" size={24} color={colors.text.muted} />
                  </Pressable>
                ) : null}
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={editing ? t('messageActions.editingMessage') : isOffline ? 'Type · saved as draft' : t('convo.composerPlaceholder')}
                  style={s.input}
                  multiline
                  maxLength={4000}
                  textAlign={isRTL ? 'right' : 'left'}
                  accessibilityLabel={t('convo.composerPlaceholder')}
                />
                {(draft.trim() !== '' || editing) ? (
                  <Pressable
                    style={[s.sendBtn, busy && { opacity: 0.4 }]}
                    onPress={send}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={editing ? t('common.save') : t('common.send')}
                    accessibilityState={{ disabled: busy }}
                  >
                    <Ionicons name={editing ? 'checkmark' : 'arrow-up'} size={20} color={colors.action.primaryFg} />
                  </Pressable>
                ) : (
                  <View
                    style={s.sendBtn}
                    {...micPan.panHandlers}
                    accessibilityRole="button"
                    accessibilityLabel={t('media.holdToRecord')}
                  >
                    <Ionicons name="mic" size={20} color={colors.action.primaryFg} />
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      )}

      <AttachmentSheet
        visible={attachOpen}
        onClose={() => setAttachOpen(false)}
        onSelect={onAttachSelect}
      />
    </KeyboardAvoidingView>
  );
}

function buildStyles(colors: any, rtl: boolean) {
  return StyleSheet.create({
    root:     { flex: 1, backgroundColor: '#FFFFFF' },
    msgList:  { flex: 1, backgroundColor: '#EAF2FB' },
    emptyConvo:    { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 6 },
    emptyAvatar:   { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    emptyAvatarText:{ color: '#fff', fontSize: 34, fontWeight: '800' },
    emptyName:     { fontSize: 20, fontWeight: '800', color: colors.text.primary, textAlign: 'center' },
    emptyHandle:   { fontSize: 13, color: colors.text.muted, textAlign: 'center' },
    e2eNotice:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FBEFD0', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 14, marginTop: 16 },
    e2eText:       { fontSize: 12, color: '#92400E' },
    emptyNudge:    { fontSize: 13, color: colors.text.muted, textAlign: 'center', marginTop: 14, lineHeight: 19 },
    header:   { paddingTop: 50, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: '#E6F1F7', flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 10, zIndex: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
    back:     { fontSize: 24, color: colors.action.primary, minWidth: 28, textAlign: 'center' },
    headerInfo: { flex: 1, flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 10 },
    headerMenuBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    headerAvatarWrap: { width: 40, height: 40 },
    headerAvatar:  { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    headerAvatarText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    onlineDot: { position: 'absolute', bottom: -1, right: rtl ? undefined : -1, left: rtl ? -1 : undefined, width: 13, height: 13, borderRadius: 7, backgroundColor: '#22C55E', borderWidth: 2, borderColor: '#E6F1F7' },
    title:    { fontSize: 16, fontWeight: '800', color: colors.text.primary, textAlign: rtl ? 'right' : 'left' },
    subtitle: { fontSize: 12, color: colors.action.primary, marginTop: 1, textAlign: rtl ? 'right' : 'left' },
    listHeader: { alignItems: 'center', gap: 10, paddingTop: 6, paddingBottom: 8 },
    datePill:   { backgroundColor: colors.background.surface, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 999, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
    datePillText: { fontSize: 12, fontWeight: '700', color: colors.text.muted },
    e2eBanner:  { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FBEFD0', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 14, maxWidth: '88%' },
    e2eBannerText: { fontSize: 12, color: '#92400E', textAlign: 'center', flexShrink: 1 },
    pinBanner: { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#FEF3C7', borderBottomWidth: 1, borderColor: '#F59E0B' },
    pinIcon:   { fontSize: 16 },
    pinTitle:  { fontSize: 11, fontWeight: '700', color: '#A16207', textAlign: rtl ? 'right' : 'left' },
    pinPreview:{ fontSize: 12, color: colors.text.primary, marginTop: 2, textAlign: rtl ? 'right' : 'left' },
    pinClose:  { fontSize: 18, color: '#A16207', fontWeight: '700', paddingHorizontal: 4, minWidth: 32, minHeight: 32, textAlignVertical: 'center', textAlign: 'center' },
    composerPreview: { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 10, padding: 10, backgroundColor: colors.background.surface, borderTopWidth: 1, borderColor: colors.border.subtle },
    composerPreviewTitle: { fontSize: 11, fontWeight: '700', color: colors.action.primary, textAlign: rtl ? 'right' : 'left' },
    composerPreviewBody:  { fontSize: 12, color: colors.text.primary, marginTop: 2, textAlign: rtl ? 'right' : 'left' },
    composerPreviewClose: { fontSize: 18, color: colors.text.muted, fontWeight: '700', paddingHorizontal: 6, minWidth: 36, minHeight: 36, textAlignVertical: 'center', textAlign: 'center' },
    composer: { padding: 12, paddingBottom: 24, flexDirection: rtl ? 'row-reverse' : 'row', gap: 8, alignItems: 'flex-end', backgroundColor: '#EAF2FB' },
    input:    { flex: 1, minHeight: 40, maxHeight: 120, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.background.surface, borderRadius: 22, borderWidth: 1, borderColor: colors.border.subtle, fontSize: 14, color: colors.text.primary },
    sendBtn:  { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.action.primary, alignItems: 'center', justifyContent: 'center' },
    attachBtn:{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    micWrap:  { width: 40, alignItems: 'center', justifyContent: 'center' },
    micRecording: { transform: [{ scale: 1.5 }] },
    lockPill: { position: 'absolute', bottom: 52, width: 34, paddingVertical: 8, borderRadius: 18, backgroundColor: colors.background.surface, alignItems: 'center', gap: 4, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
    gate:     { padding: 16, paddingBottom: 28, backgroundColor: '#EAF2FB', borderTopWidth: 1, borderColor: colors.border.subtle },
    gateText: { fontSize: 12, color: colors.text.muted, textAlign: 'center' },
  });
}
