import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList, View, Text, TextInput, Pressable, StyleSheet, Alert,
  Platform, PanResponder, Image, ScrollView, Keyboard,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import {
  subscribeMessages,
  subscribeUserState,
  sendTextMessage,
  sendRichMessage,
  markRead,
  markReceipt,
  editMessage,
  pinMessage,
  Conversation as ConversationDoc,
  Message,
  GroupRole,
  ReplyTo,
  UserState,
  subscribeMembers,
  GroupMember,
  getOrCreateDirectConversation,
} from '../lib/conversations';
import type { ReactorInfo } from '../components/ReactionsSheet';
import { useUserProfiles } from '../lib/userProfiles';
import { blockUser, unblockUser, subscribeIsBlocked } from '../lib/blocks';
import { useChatPresence, formatPresenceSubtitle } from '../hooks/useChatPresence';
import { useTypingPresence } from '../hooks/useTypingPresence';
import { useRecordingPresence } from '../hooks/useRecordingPresence';
import { stopTyping } from '../services/presenceService';
import { useWallpaper } from '../lib/wallpaper';
import { ChatWallpaperBackground } from '../components/ChatWallpaperBackground';
import { Ionicons } from '@expo/vector-icons';
import { MessageBubble } from '../components/MessageBubble';
import { MemberInfoSheet } from '../components/MemberInfoSheet';
import { useTheme } from '../context/ThemeContext';
import { isRTL } from '../i18n';
import { LoadingState, EmptyState, ErrorState } from '../components/state';
import { avatarColor, initials } from '../lib/avatar';
import { useOffline } from '../context/OfflineContext';
import { OfflineNotice, SyncSuccessChip } from '../components/OfflineBanners';
import { SyncStatusBanner } from '../components/chat/SyncStatusBanner';
import { perfBegin, perfObserve, perfNow } from '../lib/perf';
import { getDraft, setDraft as persistDraft, clearDraft } from '../lib/drafts';
import { useLocalConversation } from '../hooks/useLocalConversation';
import { useMessagePersistence } from '../hooks/useLocalPersistence';
import { queueSendMessage, queueEditMessage, queueMarkReceipt, retryMediaMessage, queueSendVoiceMessage, openLocalDb, kickSync, retryQueuedMessage } from '../localdb';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { prefetchMedia } from '../media/mediaCache';
import { AttachmentSheet } from '../components/chat/AttachmentSheet';
import { ComposerPanel } from '../components/chat/ComposerPanel';
import type { PickedSticker } from '../components/chat/StickerPanel';
import { CreatePollSheet, type PollDraft } from '../components/chat/CreatePollSheet';
import { insertAtSelection } from '../lib/emojiCatalog';
import { SwipeToReply } from '../components/chat/SwipeToReply';
import { detectMentionQuery, filterMembers, insertMention, resolveMentions, renderMentionSegments, type MentionCandidate } from '../lib/mentions';
import { LockedVoiceRecorderBar } from '../components/chat/LockedVoiceRecorderBar';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { validateMediaMessage, formatDuration, type AttachmentKey } from '../media/mediaValidation';

type ComposerGate =
  | { kind: 'allowed' }
  | { kind: 'blocked'; reason: string; canUnblock?: boolean };

// Stable no-op callbacks reused for pending-bubble props (which can never
// actually fire). Sharing one reference each lets MessageBubble's memo
// comparator skip re-renders.
const NOOP_MSG: (m: Message) => void = () => {};
const NOOP_ID: (id: string) => void  = () => {};

function gateFor(
  convo: ConversationDoc | null | undefined,
  myRole: GroupRole | null,
  isMember: boolean,
  iBlockedPeer: boolean,
): ComposerGate {
  if (!convo) return { kind: 'allowed' };
  if (convo.status === 'disabled') return { kind: 'blocked', reason: 'This conversation is disabled.' };
  // Direct chat I've blocked: composer is replaced by an unblock prompt.
  if (convo.type !== 'group' && iBlockedPeer) return { kind: 'blocked', reason: '', canUnblock: true };
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

// Milliseconds for a message timestamp (Firestore Timestamp-like or raw number).
function msOf(value: any): number {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return value;
  return 0;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Label for a day-separator pill: Today / Yesterday / a localized date.
function daySeparatorLabel(ms: number, t: (k: string, d?: string) => string): string {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, now)) return t('chat.dateToday', 'Today');
  if (isSameDay(d, yesterday)) return t('chat.dateYesterday', 'Yesterday');
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
}

export default function Conversation({ route, navigation }: any) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { id, sharedText, messageId: focusMessageId } = route.params as { id: string; sharedText?: string; messageId?: string };
  const me = auth.currentUser?.uid ?? '';
  const { isOffline, enqueue, queuedFor, deliveredFor, deliveredNonce } = useOffline();
  const wallpaper = useWallpaper(id);
  const wallpaperUri = wallpaper.type === 'custom' ? wallpaper.uri : undefined;

  // Phase 22C — local-first conversation (flag-gated). `useLocal` is true only
  // when the flag is on AND the local DB initialised; otherwise the Firestore +
  // OfflineContext path below runs unchanged (including as a fallback).
  const local = useLocalConversation(id, me, focusMessageId);
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
    // The list is inverted, so the latest message is at offset 0 (the bottom).
    requestAnimationFrame(() => listRef.current?.scrollToOffset?.({ offset: 0, animated: false }));
  }), [navigation]);

  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [convo, setConvo] = useState<ConversationDoc | null | undefined>(undefined);
  const [peerName, setPeerName] = useState<string>('Chat');
  const [peerUsername, setPeerUsername] = useState<string | null>(null);
  const [peerUid, setPeerUid] = useState<string | null>(null);
  const [iBlockedPeer, setIBlockedPeer] = useState(false);
  const [myRole, setMyRole] = useState<GroupRole | null>(null);
  const [memberStatus, setMemberStatus] = useState<'active' | 'removed' | 'left' | 'unknown'>('unknown');
  const [userState, setUserState] = useState<UserState | null>(null);

  const [replyTo, setReplyTo] = useState<ReplyTo | null>(null);
  const [editing, setEditing] = useState<{ messageId: string; originalText: string } | null>(null);
  // @mention composer state: caret position + the members the user has picked
  // (resolved to concrete spans against the final text on send).
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  // Latest draft/selection for inserting emoji at the caret (rapid taps compound).
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [selectedMentions, setSelectedMentions] = useState<Array<{ userId: string; displayName: string }>>([]);

  const listRef = useRef<FlatList<Message>>(null);
  // Scroll bookkeeping for the inverted list. "bottom" (latest) is offset 0;
  // nearBottomRef tracks whether we're there so we only auto-jump for genuinely
  // NEW newest messages — never when older history loads at the top.
  const nearBottomRef = useRef(true);
  const lastBottomIdRef = useRef<string | null>(null);
  const dataLenRef = useRef(0); // total rendered rows (messages + queued), for jumpTo index math
  // Incoming messages we've already queued read/delivered receipts for, so we
  // don't re-enqueue (and re-kick the outbox) for the whole history on every
  // refresh/pagination — that was flooding the outbox with mark_receipt items.
  const receiptedRef = useRef<Set<string>>(new Set());
  const [showScrollDown, setShowScrollDown] = useState(false);

  // Conversation doc. Firestore hands us a fresh object on every snapshot —
  // even when nothing actually changed for this screen (e.g. lastMessage
  // updates on every message). Dedupe via JSON so unchanged snapshots don't
  // re-render the whole conversation tree.
  useEffect(() => {
    if (!id) return;
    let prevKey: string | null = null;
    return onSnapshot(doc(db, 'conversations', id), snap => {
      const next = snap.exists() ? ({ id, ...snap.data() } as ConversationDoc) : null;
      const nextKey = next ? JSON.stringify(next) : '';
      if (nextKey === prevKey) return;
      prevKey = nextKey;
      setConvo(next);
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
        if (receiptedRef.current.has(m.id)) continue;
        receiptedRef.current.add(m.id);
        markReceipt(id, m.id, 'delivered');
        markReceipt(id, m.id, 'read');
      }
    });
  }, [id, me, useLocal]);

  // Local-first mode: messages come from the feeder/local DB; still emit
  // read/delivered receipts for incoming messages (callables dedupe server-side).
  useEffect(() => {
    if (!useLocal || !id) return;
    markRead(id).catch(() => {});
    // Only emit per-message receipts for incoming messages we haven't already
    // receipted this session (deduped above) — never re-mark the whole history.
    for (const m of local.messages) {
      if (m.senderUid === me) continue;
      if (m.deletedForEveryone) continue;
      if (receiptedRef.current.has(m.id)) continue;
      receiptedRef.current.add(m.id);
      void queueMarkReceipt({ conversationId: id, messageId: m.id, status: 'delivered' });
      void queueMarkReceipt({ conversationId: id, messageId: m.id, status: 'read' });
    }
    // No manual scroll here — the list is inverted (opens at the bottom) and the
    // new-message effect handles following new messages.
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

  // Whether I've blocked this direct-chat peer (drives the composer gate +
  // header menu). Private to me (users/{me}/blockedUsers/{peer}).
  useEffect(() => {
    const direct = convo?.type !== 'group';
    if (direct && peerUid) return subscribeIsBlocked(me, peerUid, setIBlockedPeer);
    setIBlockedPeer(false);
  }, [convo?.type, peerUid, me]);

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
  // Header avatar: direct peer photo, or the group's avatar for groups.
  const headerPhoto = isDirect ? peerPhoto : (convo?.avatarUrl ?? null);
  const reactorNames = useMemo<Record<string, ReactorInfo>>(() => {
    const map: Record<string, ReactorInfo> = {};
    for (const m of members) {
      const prof = memberProfiles[m.uid];
      map[m.uid] = {
        name: m.displayNameSnapshot || prof?.displayName || m.uid.slice(0, 6),
        // Prefer the member's LIVE profile photo over the add-time snapshot.
        // The snapshot is captured when the member joins and goes stale once
        // they change their picture (a broken URL → invisible avatar), whereas
        // the chat list reads the live photo — so the group bubble would
        // disagree with the list. Fall back to the snapshot only while the
        // live profile is still loading / unavailable (offline-first).
        photoURL: prof?.photoURL || m.photoURLSnapshot || null,
      };
    }
    return map;
  }, [members, memberProfiles]);

  // @mention suggestions (groups only). Candidates are the current group members
  // (excluding me) — so a user can never be mentioned outside the group. The
  // active query is derived from the caret position in the draft.
  const mentionCandidates = useMemo<MentionCandidate[]>(() => {
    if (convo?.type !== 'group') return [];
    return members
      .filter(m => m.uid !== me && (m.status ?? 'active') === 'active')
      .map(m => ({
        uid: m.uid,
        displayName: reactorNames[m.uid]?.name ?? m.displayNameSnapshot ?? m.uid.slice(0, 6),
        username: (memberProfiles[m.uid] as any)?.username ?? null,
        phone: null,
      }));
  }, [convo?.type, members, me, reactorNames, memberProfiles]);

  const activeMention = useMemo(
    () => (convo?.type === 'group' && !editing ? detectMentionQuery(draft, selection.end) : null),
    [convo?.type, editing, draft, selection.end],
  );
  const mentionSuggestions = useMemo(
    // High cap so the (scrollable) list can show every matching member, not a
    // truncated handful.
    () => (activeMention ? filterMembers(mentionCandidates, activeMention.query, 100) : []),
    [activeMention, mentionCandidates],
  );
  // Split the live draft into mention / plain runs so the composer can render
  // inserted mentions bold + colored (like WhatsApp/Telegram). Null when there's
  // nothing to highlight, so plain typing renders as a single string child.
  const draftSegments = useMemo(() => {
    if (convo?.type !== 'group' || selectedMentions.length === 0) return null;
    const mentions = resolveMentions(draft, selectedMentions);
    if (mentions.length === 0) return null;
    return renderMentionSegments(draft, mentions);
  }, [convo?.type, draft, selectedMentions]);

  const pickMention = useCallback((m: MentionCandidate) => {
    if (!activeMention) return;
    const r = insertMention(draft, activeMention.start, selection.end, m);
    setDraft(r.text);
    setSelection({ start: r.cursor, end: r.cursor });
    setSelectedMentions(prev =>
      prev.some(x => x.userId === m.uid) ? prev : [...prev, { userId: m.uid, displayName: m.displayName }],
    );
  }, [activeMention, draft, selection.end]);

  // Group chat: tap a sender's avatar → member-info sheet (avatar/name/handle +
  // quick actions). Holds the tapped uid; the sheet is seeded from reactorNames
  // for an instant paint, then upgrades to the live public profile.
  const [infoMemberUid, setInfoMemberUid] = useState<string | null>(null);
  const onAvatarPress = useCallback((uid: string) => setInfoMemberUid(uid), []);
  const openMemberChat = useCallback(async (uid: string) => {
    setInfoMemberUid(null);
    try {
      const conversationId = await getOrCreateDirectConversation(uid);
      // push (not navigate) so the group stays on the back stack — we're already
      // on a Conversation screen and navigate() would just swap its params.
      (navigation.push ?? navigation.navigate)('Conversation', { id: conversationId });
    } catch (e: any) {
      Alert.alert('Couldn’t open chat', e?.message ?? 'Please try again.');
    }
  }, [navigation]);

  // Presence: peer online/last-seen + everyone's typing/recording activity.
  const presence = useChatPresence(id, isDirect ? peerUid : null);
  // Outbound typing (debounced; auto-stops on send/clear/leave; off while editing).
  useTypingPresence(id, draft, !editing);

  // Restore a saved draft when opening the chat. Text shared into the app (via
  // ShareToChat → sharedText) takes precedence and pre-fills the composer.
  useEffect(() => {
    let on = true;
    if (sharedText) { setDraft(prev => prev || sharedText); return () => { on = false; }; }
    getDraft(id).then(text => { if (on && text) setDraft(prev => prev || text); });
    return () => { on = false; };
  }, [id, sharedText]);

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
    () => gateFor(convo, myRole, memberStatus === 'active' || memberStatus === 'unknown', iBlockedPeer),
    [convo, myRole, memberStatus, iBlockedPeer],
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

  // Cache media to the device so images/voice load instantly on revisit.
  useEffect(() => { if (visibleMsgs) prefetchMedia(visibleMsgs); }, [visibleMsgs]);

  // Bubble handlers — useCallback so MessageBubble's memo comparator sees
  // stable references and only re-renders when its own data changes.
  const jumpTo = useCallback((messageId: string) => {
    if (!visibleMsgs) return;
    const idx = visibleMsgs.findIndex(m => m.id === messageId);
    if (idx < 0) return;
    // The list is inverted: index 0 is the newest. Map the chronological index
    // to the inverted one across the full data length (messages + queued).
    const total = dataLenRef.current || visibleMsgs.length;
    listRef.current?.scrollToIndex?.({ index: total - 1 - idx, animated: true, viewPosition: 0.5 });
  }, [visibleMsgs]);

  // Reset the failed job before waking sync, retaining its original local id.
  const retrySend = useCallback((message: Message) => {
    if (useLocal) void retryQueuedMessage(message.id);
    else kickSync('manual');
  }, [useLocal]);

  const startReply = useCallback((m: Message) => {
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
  }, []);
  const startEdit = useCallback((m: Message) => {
    setReplyTo(null);
    setEditing({ messageId: m.id, originalText: m.text ?? '' });
    setDraft(m.text ?? '');
  }, []);
  function cancelEdit() {
    setEditing(null);
    setDraft('');
  }
  const startForward = useCallback((m: Message) => {
    navigation.navigate('ForwardPicker', {
      sourceConversationId: id,
      messageIds: [m.id],
    });
  }, [navigation, id]);
  const openInfo = useCallback((m: Message) => {
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
  }, [navigation, id, isGroup, peerName, convo?.memberCount]);
  async function unpin() {
    const messageId = convo?.pinnedMessage?.messageId;
    if (!messageId) return;
    try { await pinMessage(id, messageId, false); }
    catch (e: any) { Alert.alert("Couldn't unpin", e?.message ?? 'try-again'); }
  }

  // Phase 23 — attachment sheet + image picking.
  const [attachOpen, setAttachOpen] = useState(false);
  // Emoji / sticker panel shown in place of the keyboard; sized like the last
  // keyboard so toggling between them doesn't make the conversation jump.
  const [panelOpen, setPanelOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [panelHeight, setPanelHeight] = useState(290);
  const inputRef = useRef<TextInput>(null);
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', e => {
      const h = Math.round(e.endCoordinates.height - insets.bottom);
      if (h > 180) setPanelHeight(h);
    });
    return () => sub.remove();
  }, [insets.bottom]);
  const togglePanel = useCallback(() => {
    setPanelOpen(open => {
      if (open) { requestAnimationFrame(() => inputRef.current?.focus()); return false; }
      Keyboard.dismiss();
      return true;
    });
  }, []);
  const insertEmoji = useCallback((emoji: string) => {
    const r = insertAtSelection(draftRef.current, selectionRef.current, emoji);
    draftRef.current = r.draft;
    selectionRef.current = { start: r.caret, end: r.caret };
    setDraft(r.draft);
    setSelection(selectionRef.current);
  }, []);

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
    } else if (key === 'poll') {
      setPollOpen(true);
    } else if (key === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert(t('media.cameraPermissionTitle'), t('media.cameraPermissionMessage')); return; }
      const res = await ImagePicker.launchCameraAsync({ quality: 0.8 });
      await handleAsset(res);
    }
  }

  const openImage  = useCallback((uri: string) => navigation.navigate('ImageViewer', { uri }), [navigation]);
  const retryMedia = useCallback((msg: Message) => { void retryMediaMessage(msg.id); }, []);
  const onSendViaSms = useCallback((msg: Message) => {
    // A message that hasn't synced yet only has a LOCAL id — the escalation
    // callables would 404 on it ("Preview failed · Not found"). Block early
    // with a clear explanation instead.
    if (msg.status === 'sending' || msg.status === 'failed') {
      Alert.alert(t('sms.notSyncedTitle'), t('sms.notSyncedMessage'));
      return;
    }
    navigation.navigate('SmsEscalation', {
      conversationId: id,
      messageId:      msg.id,
      messageText:    msg.text,
    });
  }, [navigation, id, t]);

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

  function confirmBlock() {
    if (!peerUid || !me) return;
    Alert.alert(
      t('block.blockTitle', { name: peerName }),
      t('block.blockMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('block.blockUser'), style: 'destructive',
          onPress: () => { blockUser(me, peerUid).catch(() => Alert.alert(t('block.blockUser'), t('block.blockFailed'))); },
        },
      ],
    );
  }
  function confirmUnblock() {
    if (!peerUid || !me) return;
    Alert.alert(
      t('block.unblockTitle', { name: peerName }),
      t('block.unblockMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('block.unblockUser'),
          onPress: () => { unblockUser(me, peerUid).catch(() => Alert.alert(t('block.unblockUser'), t('block.unblockFailed'))); },
        },
      ],
    );
  }
  // Header overflow menu: clear chat, plus block/unblock for direct chats.
  function openChatMenu() {
    const buttons: any[] = [
      { text: t('chats.clearChat'), onPress: confirmClearChat },
    ];
    if (convo?.type !== 'group' && peerUid) {
      buttons.push(iBlockedPeer
        ? { text: t('block.unblockUser'), onPress: confirmUnblock }
        : { text: t('block.blockUser'), style: 'destructive', onPress: confirmBlock });
    }
    buttons.push({ text: t('common.cancel'), style: 'cancel' });
    Alert.alert(peerName, undefined, buttons);
  }
  const onPlayedVoice = useCallback((msg: Message) => {
    if (msg.senderUid !== me) void queueMarkReceipt({ conversationId: id, messageId: msg.id, status: 'played' });
  }, [id, me]);

  // Phase 23 — voice recording (hold mic → record, slide left → cancel, swipe up → lock).
  const recorder = useVoiceRecorder();
  const modeRef = useRef(recorder.mode);
  useEffect(() => { modeRef.current = recorder.mode; }, [recorder.mode]);
  // Publish recording presence while the recorder is active (recording/locked).
  useRecordingPresence(id, recorder.mode === 'recording' || recorder.mode === 'locked');
  const cancelArmedRef = useRef(false);
  const [cancelArmed, setCancelArmed] = useState(false);
  // Hold threshold: a quick tap on the mic must not start recording (otherwise
  // a tap → release races recorder.start() and ends up sending an empty/
  // too-short voice note). Recording only starts after the user has held the
  // mic for ~250ms; releasing earlier cancels the pending start cleanly.
  const HOLD_MS = 250;
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef   = useRef(false);
  function clearHoldTimer() {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
  }
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
        // Schedule the actual start. A quick tap (release before HOLD_MS)
        // cancels the timer and never enters the recorder, so there's no
        // empty/too-short voice note and no race with stop().
        startedRef.current = false;
        clearHoldTimer();
        holdTimerRef.current = setTimeout(() => {
          holdTimerRef.current = null;
          void (async () => {
            const ok = await recorder.start();
            if (!ok) { Alert.alert(t('media.microphonePermissionTitle'), t('media.microphonePermissionMessage')); return; }
            startedRef.current = true;
          })();
        }, HOLD_MS);
      },
      onPanResponderMove: (_evt, g) => {
        if (modeRef.current !== 'recording') return;
        if (g.dy < -70) recorder.lock();
        const armed = g.dx < -80;
        if (armed !== cancelArmedRef.current) { cancelArmedRef.current = armed; setCancelArmed(armed); }
      },
      onPanResponderRelease: () => {
        // Released before the hold threshold → no recording was ever started.
        if (holdTimerRef.current) { clearHoldTimer(); return; }
        void (async () => {
          if (modeRef.current === 'locked') return; // locked → use bar buttons
          if (cancelArmedRef.current) { cancelArmedRef.current = false; setCancelArmed(false); await recorder.cancel(); return; }
          if (!startedRef.current)    { await recorder.cancel(); return; } // start() failed
          const res = await recorder.stop();
          startedRef.current = false;
          await sendVoice(res);
        })();
      },
      onPanResponderTerminate: () => {
        if (holdTimerRef.current) { clearHoldTimer(); return; }
        if (modeRef.current !== 'locked' && startedRef.current) void recorder.cancel();
      },
    }),
  ).current;

  // Stickers and polls: same local-first outbox (and the same server send
  // gates) as text; the legacy path calls the callable directly.
  async function sendRich(rich: { kind: 'sticker'; sticker: PickedSticker } | { kind: 'poll'; poll: PollDraft }) {
    if (gate.kind !== 'allowed') return;
    setErr(null);
    try {
      if (useLocal) {
        await queueSendMessage({
          conversationId: id, senderUid: me, text: '',
          ...(rich.kind === 'sticker' ? { kind: 'sticker', sticker: rich.sticker } : { kind: 'poll', poll: rich.poll }),
          replyTo: rich.kind === 'sticker' && replyTo ? {
            messageId: replyTo.messageId, senderUid: replyTo.senderUid, senderDisplayName: replyTo.senderDisplayName,
            preview: replyTo.preview, type: replyTo.type,
          } : null,
        });
        local.refresh();
      } else {
        await sendRichMessage(id, rich.kind === 'sticker'
          ? { kind: 'sticker', sticker: { packId: rich.sticker.packId, stickerId: rich.sticker.stickerId } }
          : { kind: 'poll', poll: rich.poll });
      }
      if (rich.kind === 'sticker') setReplyTo(null);
    } catch (e: any) {
      const code = e?.message ?? 'send-failed';
      if (code === 'blocked-by-recipient') setErr(t('block.cannotSendBlockedBy'));
      else if (code === 'recipient-blocked') setErr(t('block.cannotSendBlocked'));
      else setErr(code);
    }
  }
  const sendSticker = useCallback((st: PickedSticker) => { void sendRich({ kind: 'sticker', sticker: st }); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [useLocal, id, me, replyTo, gate.kind]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    if (gate.kind !== 'allowed' && !editing) return;
    // Resolve @mentions against the final (trimmed) text so spans are correct
    // regardless of edits made after each mention was inserted. Only members the
    // user actually picked (all in this group) can match.
    const mentions = isGroup ? resolveMentions(text, selectedMentions) : [];
    const clearComposer = () => { setReplyTo(null); setDraft(''); setSelectedMentions([]); setSelection({ start: 0, end: 0 }); clearDraft(id); stopTyping(id); };
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
        const sendStartedAt = perfNow();
        const queued = await queueSendMessage({
          conversationId: id,
          senderUid: me,
          text,
          replyTo: replyTo ? {
            messageId: replyTo.messageId,
            senderUid: replyTo.senderUid,
            senderDisplayName: replyTo.senderDisplayName,
            preview: replyTo.preview,
            type: replyTo.type,
          } : null,
          mentions: mentions.length ? mentions : null,
        });
        // Timing (test builds): send tap → own message rendered.
        perfBegin('send_to_visible', { id: queued.local_id }, sendStartedAt);
        local.refresh();
        clearComposer();
      } else if (isOffline) {
        // Offline-first: persist locally and deliver on reconnect.
        await enqueue({ conversationId: id, conversationType: isGroup ? 'group' : 'direct', text, replyTo: replyTo ?? null, mentions: mentions.length ? mentions : null });
        clearComposer();
      } else {
        await sendTextMessage(id, text, replyTo, mentions.length ? mentions : null);
        clearComposer();
      }
    } catch (e: any) {
      const code = e?.message ?? 'send-failed';
      if (code === 'blocked-by-recipient') setErr(t('block.cannotSendBlockedBy'));
      else if (code === 'recipient-blocked') setErr(t('block.cannotSendBlocked'));
      else setErr(code);
    } finally {
      setBusy(false);
    }
  }

  const s = buildStyles(colors, isRTL);

  const headerSubtitle = useMemo(() => {
    const groupFallback = convo?.memberCount
      ? `${convo.memberCount} members${convo?.status === 'locked' ? ' · locked' : ''}`
      : '';
    return formatPresenceSubtitle(presence, {
      isGroup,
      t,
      nameFor: (uid) => reactorNames[uid]?.name ?? memberProfiles[uid]?.displayName ?? uid.slice(0, 6),
      groupFallback,
    }) || null;
  }, [presence, isGroup, convo?.memberCount, convo?.status, reactorNames, memberProfiles, t]);

  const queued = queuedFor(id);

  // Build the queued (legacy offline-queue) bubbles separately so we can
  // memoise them by `queued` reference and keep `data` stable when nothing
  // changed.
  const queuedItems = useMemo(() => queued.map(q => ({
    id:             q.localQueueId,
    conversationId: id,
    senderUid:      me,
    type:           'text' as const,
    text:           q.text,
    createdAt:      { toMillis: () => q.createdAt },
    __pending:      q.status as 'queued' | 'syncing' | 'failed',
  })), [queued, id, me]);

  // Single useMemo for the FlatList `data` so its reference is stable when
  // neither input changed — saves FlatList an O(n) diff per parent render.
  const data = useMemo<any[]>(() => {
    if (!visibleMsgs) return [];
    if (queuedItems.length === 0) return visibleMsgs;
    return [...visibleMsgs, ...queuedItems];
  }, [visibleMsgs, queuedItems]);

  // Load older history when the user scrolls near the top. The list is NOT
  // inverted (oldest at top, newest at bottom), so "older" lives at the top.
  // local.loadOlder grows the local window and, when local history is
  // exhausted, back-fills from Firestore — so evicted/older messages return.
  // Inverted list: newest is at the top of the data array (index 0) and the
  // bottom of the screen (scroll offset 0).
  const invData = useMemo(() => data.slice().reverse(), [data]);

  // Timing (test builds, src/lib/perf.ts): the same screen-level points as the
  // baseline build — open → first rows, and every render reports its ids so
  // tap/send/older spans end when their message is in the rendered list.
  const renderedRef = useRef<string[]>([]);
  useEffect(() => { perfBegin('conversation_open'); }, [id]);
  useEffect(() => {
    const ids = invData.map((m: any) => m.id as string);
    renderedRef.current = ids;
    perfObserve(ids);
  }, [invData]);
  useEffect(() => { dataLenRef.current = data.length; }, [data]);

  const onListScroll = useCallback((e: any) => {
    // Inverted: the bottom (latest) is offset 0; away from it → show the button.
    const nearBottom = e.nativeEvent.contentOffset.y <= 80;
    nearBottomRef.current = nearBottom;
    setShowScrollDown(prev => (prev === !nearBottom ? prev : !nearBottom));
  }, []);

  // Pagination: onEndReached fires near the visual TOP in an inverted list.
  // Depends on the STABLE loadOlder (not the whole `local` object), so the
  // memoised list body isn't rebuilt on every render.
  const loadOlder = local.loadOlder;
  const onReachOlder = useCallback(() => {
    if (!useLocal) return;
    // Timing (test builds): request → older messages rendered.
    const rendered = renderedRef.current;
    perfBegin('older_to_visible', { minCount: rendered.length + 1, lastNot: rendered[rendered.length - 1] });
    loadOlder();
  }, [useLocal, loadOlder]);

  // Notification deep link: once the target message is on screen, scroll to it
  // and briefly highlight it. Runs once per target.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const focusedRef = useRef<string | null>(null);
  useEffect(() => {
    const f = local.focus;
    if (!f || f.state !== 'ready' || focusedRef.current === f.messageId) return;
    const idx = invData.findIndex((m: any) => m.id === f.messageId);
    if (idx < 0) return;
    focusedRef.current = f.messageId;
    setHighlightId(f.messageId);
    requestAnimationFrame(() => {
      if (idx === 0) listRef.current?.scrollToOffset?.({ offset: 0, animated: true });
      else listRef.current?.scrollToIndex?.({ index: idx, animated: true, viewPosition: 0.5 });
    });
    const h = setTimeout(() => setHighlightId(null), 2500);
    return () => clearTimeout(h);
  }, [local.focus, invData]);

  const scrollToBottom = useCallback(() => {
    // One reliable jump — offset 0 is the latest message in an inverted list.
    listRef.current?.scrollToOffset?.({ offset: 0, animated: true });
    nearBottomRef.current = true;
    setShowScrollDown(false);
  }, []);

  // Jump to the bottom only for genuinely new newest messages: ones I sent, or
  // incoming ones while I'm already near the bottom. If I'm reading older
  // messages, leave my position alone and surface the scroll-to-latest button.
  useEffect(() => {
    if (!data.length) return;
    const last = data[data.length - 1]; // chronological newest
    const lastId: string | null = last?.id ?? null;
    if (lastBottomIdRef.current === lastId) return; // older loaded → not a new bottom msg
    const prev = lastBottomIdRef.current;
    lastBottomIdRef.current = lastId;
    if (prev == null) return; // first population — inverted list already sits at the bottom
    const mine = last?.senderUid === me || (last as any)?.senderId === me;
    if (mine || nearBottomRef.current) {
      requestAnimationFrame(() => listRef.current?.scrollToOffset?.({ offset: 0, animated: true }));
    } else {
      setShowScrollDown(true);
    }
  }, [data, me]);

  const body = useMemo(() => {
    if (visibleMsgs === null) return <LoadingState fullPage title="Loading messages…" />;

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

    return (
      <FlatList
        ref={listRef}
        style={s.msgList}
        // Inverted: index 0 (newest) renders at the bottom and the list opens
        // there automatically — so "scroll to latest" is just offset 0, and
        // loading older history (appended to the data tail) never moves the view.
        inverted
        data={invData}
        keyExtractor={(m: any) => m.id}
        contentContainerStyle={{ padding: 12, gap: 4 }}
        // In an inverted list the footer renders at the visual TOP, so the
        // "encrypted" banner sits above the oldest message as intended.
        ListFooterComponent={
          <View style={s.listHeader}>
            <View style={s.e2eBanner}>
              <Ionicons name="lock-closed" size={12} color="#92400E" />
              <Text style={s.e2eBannerText}>Messages and calls are end-to-end encrypted</Text>
            </View>
          </View>
        }
        onScroll={onListScroll}
        scrollEventThrottle={64}
        // Page in older history when the user nears the top of the inverted list.
        onEndReached={onReachOlder}
        onEndReachedThreshold={0.4}
        onScrollToIndexFailed={(info) => {
          // Reply-jump target not measured yet: approximate, then retry.
          listRef.current?.scrollToOffset?.({ offset: info.averageItemLength * info.index, animated: false });
          setTimeout(() => listRef.current?.scrollToIndex?.({ index: info.index, animated: true, viewPosition: 0.5 }), 120);
        }}
        // FlatList tuning. removeClippedSubviews is left OFF: combined with an
        // inverted list on Android it can blank out rows.
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={10}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews={false}
        renderItem={({ item, index }) => {
          if (item.__pending) {
            return (
              <MessageBubble
                message={item}
                pending={item.__pending}
                showSender={false}
                context={{ conversationId: id, isGroup, isMyMessage: true, myRoleIsAdmin, isStarred: false, isPinned: false, myUid: me, memberCount: convo?.memberCount, localFirst: useLocal }}
                onReply={NOOP_MSG}
                onEditStart={NOOP_MSG}
                onForward={NOOP_MSG}
                onJumpTo={NOOP_ID}
                onInfo={NOOP_MSG}
              />
            );
          }
          const mine = item.senderUid === me || (item as any).senderId === me;
          // Surface real send state for my own not-yet-synced text/sticker/poll messages so
          // they show "Sending/Queued/Failed" instead of a misleading "Seen by
          // 0" — and so the un-pushed message has no server-info menu (which
          // would 404 with message-not-found). Media keeps its own upload UI.
          const sendState: 'queued' | 'syncing' | 'failed' | undefined =
            mine && !item.deletedForEveryone && ['text', 'sticker', 'poll'].includes(item.type ?? 'text')
              ? (item.status === 'failed' ? 'failed'
                : item.status === 'sending' ? (isOffline ? 'queued' : 'syncing')
                : undefined)
              : undefined;
          // Inverted data is newest-first, so the chronologically-previous
          // (older) message — the one rendered just above — is at index + 1.
          const previous = index < invData.length - 1 ? invData[index + 1] : null;
          const showSender = isGroup && !mine && (!previous || previous.__pending || previous.senderUid !== item.senderUid);
          // Day separator: shown above the first message of each day (i.e. when
          // the older message above belongs to a different calendar day, or this
          // is the very oldest message). Rendered above the bubble in the cell so
          // — even inverted — it appears at the top of that day's group.
          const ts = msOf(item.createdAt);
          const prevTs = previous ? msOf(previous.createdAt) : 0;
          const showDate = ts > 0 && (!prevTs || !isSameDay(new Date(ts), new Date(prevTs)));
          const bubble = (
            <SwipeToReply enabled={!sendState && !item.deletedForEveryone} onReply={() => startReply(item)}>
            <MessageBubble
              message={item}
              pending={sendState}
              onRetry={retrySend}
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
              onSendViaSms={onSendViaSms}
              onAvatarPress={onAvatarPress}
              onMentionPress={onAvatarPress}
            />
            </SwipeToReply>
          );
          const cell = item.id === highlightId ? <View style={s.focusHighlight}>{bubble}</View> : bubble;
          if (!showDate) return cell;
          return (
            <>
              <View style={s.dateSep}>
                <View style={s.datePill}><Text style={s.datePillText}>{daySeparatorLabel(ts, t as any)}</Text></View>
              </View>
              {cell}
            </>
          );
        }}
      />
    );
  }, [invData, visibleMsgs, queuedItems, me, isGroup, id, myRoleIsAdmin, starred, convo?.pinnedMessage, convo?.memberCount, reactorNames, useLocal, startReply, startEdit, startForward, jumpTo, openInfo, openImage, retryMedia, onPlayedVoice, onSendViaSms, onAvatarPress, onListScroll, onReachOlder, t, isOffline, retrySend, highlightId]);

  return (
    <KeyboardAvoidingView behavior="padding" style={s.root}>
      {/* Wallpaper layer — absolute-fill, behind everything; theme bg is the
          fallback when no wallpaper is set. Memoised on the URI. */}
      <ChatWallpaperBackground uri={wallpaperUri} />
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
            {headerPhoto ? (
              <Image source={{ uri: headerPhoto }} style={s.headerAvatar} />
            ) : (
              <View style={[s.headerAvatar, { backgroundColor: avatarColor(peerUid ?? peerName) }]}>
                <Text style={s.headerAvatarText}>{initials(peerName)}</Text>
              </View>
            )}
            {!isGroup && presence.online ? <View style={s.onlineDot} /> : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>{peerName}</Text>
            {headerSubtitle ? <Text style={s.subtitle}>{headerSubtitle}</Text> : null}
          </View>
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate('ChatWallpaper', { conversationId: id })}
          hitSlop={10}
          style={s.headerMenuBtn}
          accessibilityRole="button"
          accessibilityLabel="Chat wallpaper"
        >
          <Ionicons name="image-outline" size={20} color={colors.text.muted} />
        </Pressable>
        <Pressable
          onPress={openChatMenu}
          hitSlop={10}
          style={s.headerMenuBtn}
          accessibilityRole="button"
          accessibilityLabel={t('common.more', { defaultValue: 'More' })}
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

      {showScrollDown ? (
        <Pressable
          onPress={scrollToBottom}
          accessibilityRole="button"
          accessibilityLabel={t('common.scrollToLatest', 'Scroll to latest messages')}
          style={{
            position: 'absolute', right: 16, bottom: 88,
            width: 44, height: 44, borderRadius: 22,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: colors.background.surface, borderWidth: 1, borderColor: colors.border.subtle,
            shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 5,
          }}
        >
          <Ionicons name="chevron-down" size={24} color={colors.action.primary} />
        </Pressable>
      ) : null}

      {deliveredChip > 0 ? <SyncSuccessChip count={deliveredChip} /> : null}
      {useLocal
        ? <SyncStatusBanner focus={local.focus} live={isOffline ? 'offline' : local.live} onRetry={local.retryFocus} />
        : (isOffline ? <OfflineNotice /> : null)}

      {err ? <ErrorState compact title="Couldn't send" description={err} /> : null}

      {gate.kind === 'blocked' && !editing ? (
        <View style={[s.gate, { paddingBottom: insets.bottom + 16 }]}>
          {gate.canUnblock ? (
            <>
              <Text style={s.gateText}>{t('block.youBlockedThis')}</Text>
              <Pressable
                onPress={confirmUnblock}
                style={s.gateAction}
                accessibilityRole="button"
                accessibilityLabel={t('block.unblockUser')}
              >
                <Text style={s.gateActionText}>{t('block.unblockUser')}</Text>
              </Pressable>
            </>
          ) : (
            <Text style={s.gateText}>{gate.reason}</Text>
          )}
        </View>
      ) : (
        <View style={{ backgroundColor: 'transparent' }}>
          {mentionSuggestions.length > 0 ? (
            <View style={s.mentionList}>
              <ScrollView
                style={s.mentionScroll}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                {mentionSuggestions.map((m, i) => (
                  <View key={m.uid}>
                    {i > 0 ? <View style={s.mentionDivider} /> : null}
                    <Pressable
                      style={({ pressed }) => [s.mentionRow, pressed && s.mentionRowPressed]}
                      onPress={() => pickMention(m)}
                      accessibilityRole="button"
                      accessibilityLabel={m.displayName}
                    >
                      <View style={[s.mentionAvatar, { backgroundColor: avatarColor(m.uid) }]}>
                        {reactorNames[m.uid]?.photoURL ? (
                          <Image source={{ uri: reactorNames[m.uid]!.photoURL! }} style={s.mentionAvatarImg} />
                        ) : (
                          <Text style={s.mentionAvatarText}>{initials(m.displayName)}</Text>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.mentionName} numberOfLines={1}>{m.displayName}</Text>
                        {m.username ? <Text style={s.mentionSub} numberOfLines={1}>@{m.username}</Text> : null}
                      </View>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}
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
          <View style={[s.composer, { marginBottom: panelOpen ? 8 : insets.bottom + 10 }]}>
            {recorder.mode === 'locked' ? (
              <LockedVoiceRecorderBar
                elapsedMs={recorder.elapsedMs}
                bars={recorder.bars}
                paused={recorder.paused}
                onTrash={() => { void recorder.cancel(); }}
                onTogglePause={() => { void recorder.togglePause(); }}
                onSend={() => { void (async () => { const res = await recorder.stop(); await sendVoice(res); })(); }}
              />
            ) : (
              <>
                {/* Telegram layout: a solid white pill (emoji · Message ·
                    attach) with the wallpaper visible around it, and a big
                    round blue action button beside it. While recording, the
                    pill's left region swaps to an inline indicator. */}
                <View style={s.inputPill}>
                  <View style={s.pillLeft}>
                    {recorder.mode === 'recording' ? (
                      <View style={s.recordingInline}>
                        <View style={s.recDot} />
                        <Text style={s.recTimer}>{formatDuration(recorder.elapsedMs)}</Text>
                        <Text style={[s.recHint, cancelArmed && s.recHintArmed]} numberOfLines={1}>
                          {cancelArmed ? t('media.slideToCancel') : `‹ ${t('media.slideToCancel')}`}
                        </Text>
                      </View>
                    ) : (
                      <>
                        {!editing ? (
                          <Pressable
                            style={s.inlineIconLead}
                            onPress={togglePanel}
                            accessibilityRole="button"
                            accessibilityLabel={panelOpen ? t('composer.keyboard') : t('composer.emojiAndStickers')}
                          >
                            <Ionicons name={panelOpen ? 'keypad-outline' : 'happy-outline'} size={24} color={colors.text.muted} />
                          </Pressable>
                        ) : null}
                        <TextInput
                          ref={inputRef}
                          onFocus={() => setPanelOpen(false)}
                          onChangeText={setDraft}
                          onSelectionChange={e => setSelection(e.nativeEvent.selection)}
                          placeholder={editing ? t('messageActions.editingMessage') : isOffline ? 'Type · saved as draft' : t('convo.composerPlaceholder')}
                          style={s.input}
                          multiline
                          maxLength={4000}
                          textAlign={isRTL ? 'right' : 'left'}
                          accessibilityLabel={t('convo.composerPlaceholder')}
                        >
                          {/* Formatted children when the draft has mentions
                              (bold + colored); otherwise the plain string. The
                              TextInput is controlled by these children. */}
                          {draftSegments
                            ? draftSegments.map((seg, i) =>
                                seg.type === 'mention'
                                  ? <Text key={i} style={s.composerMentionText}>{seg.text}</Text>
                                  : <Text key={i}>{seg.text}</Text>,
                              )
                            : draft}
                        </TextInput>
                        {!editing ? (
                          <Pressable
                            style={s.inlineIcon}
                            onPress={() => setAttachOpen(true)}
                            accessibilityRole="button"
                            accessibilityLabel={t('media.attach')}
                          >
                            <Ionicons name="attach" size={22} color={colors.text.muted} />
                          </Pressable>
                        ) : null}
                      </>
                    )}
                  </View>
                </View>

                {/* Round blue action circle (Telegram): send while composing
                    text/editing, mic otherwise. The mic node keeps a FIXED
                    tree position (micWrap's 2nd child, lock pill always
                    mounted above it) so its PanResponder survives the
                    idle→recording transition. */}
                {(draft.trim() !== '' || editing) ? (
                  <Pressable
                    style={[s.actionCircle, busy && { opacity: 0.4 }]}
                    onPress={send}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={editing ? t('common.save') : t('common.send')}
                    accessibilityState={{ disabled: busy }}
                  >
                    <Ionicons name={editing ? 'checkmark' : 'arrow-up'} size={22} color={colors.action.primaryFg} />
                  </Pressable>
                ) : (
                  <View style={s.micWrap}>
                    <View
                      style={[s.lockPill, recorder.mode !== 'recording' && s.lockPillHidden]}
                      pointerEvents="none"
                    >
                      <Ionicons name="lock-closed" size={16} color={colors.text.muted} />
                      <Ionicons name="chevron-up" size={14} color={colors.text.muted} />
                    </View>
                    <View
                      style={[s.actionCircle, recorder.mode === 'recording' && s.micRecording]}
                      {...micPan.panHandlers}
                      accessibilityRole="button"
                      accessibilityLabel={t('media.holdToRecord')}
                    >
                      <Ionicons name="mic" size={recorder.mode === 'recording' ? 28 : 24} color={colors.action.primaryFg} />
                    </View>
                  </View>
                )}
              </>
            )}
          </View>
          {panelOpen && me ? (
            <ComposerPanel
              uid={me}
              height={panelHeight}
              bottomInset={insets.bottom}
              onEmoji={insertEmoji}
              onSticker={sendSticker}
            />
          ) : null}
        </View>
      )}

      <AttachmentSheet
        visible={attachOpen}
        onClose={() => setAttachOpen(false)}
        onSelect={onAttachSelect}
      />

      <CreatePollSheet
        visible={pollOpen}
        onClose={() => setPollOpen(false)}
        onCreate={poll => { setPollOpen(false); void sendRich({ kind: 'poll', poll }); }}
      />

      <MemberInfoSheet
        visible={!!infoMemberUid}
        uid={infoMemberUid}
        fallbackName={infoMemberUid ? reactorNames[infoMemberUid]?.name : null}
        fallbackPhoto={infoMemberUid ? reactorNames[infoMemberUid]?.photoURL : null}
        isSelf={infoMemberUid === me}
        onClose={() => setInfoMemberUid(null)}
        onMessage={openMemberChat}
        onViewGroupInfo={() => navigation.navigate('GroupInfo', { id })}
      />
    </KeyboardAvoidingView>
  );
}

function buildStyles(colors: any, rtl: boolean) {
  return StyleSheet.create({
    // Transparent root: the ChatWallpaperBackground (absolute-fill, always
    // rendered — custom wallpaper or the bundled default) is the ONLY screen
    // background, so no white surface can show through the transparent
    // composer band around the input pill.
    root:     { flex: 1, backgroundColor: 'transparent' },
    // Transparent so the ChatWallpaperBackground layer shows through.
    msgList:  { flex: 1, backgroundColor: 'transparent' },
    emptyConvo:    { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 6 },
    emptyAvatar:   { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    emptyAvatarText:{ color: '#fff', fontSize: 34, fontWeight: '800' },
    emptyName:     { fontSize: 20, fontWeight: '800', color: colors.text.primary, textAlign: 'center' },
    emptyHandle:   { fontSize: 13, color: colors.text.muted, textAlign: 'center' },
    e2eNotice:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FBEFD0', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 14, marginTop: 16 },
    e2eText:       { fontSize: 12, color: '#92400E' },
    emptyNudge:    { fontSize: 13, color: colors.text.muted, textAlign: 'center', marginTop: 14, lineHeight: 19 },
    header:   { paddingTop: 50, paddingBottom: 12, paddingHorizontal: 14, backgroundColor: colors.background.surface, flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 10, zIndex: 2, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
    back:     { fontSize: 24, color: colors.action.primary, minWidth: 28, textAlign: 'center' },
    headerInfo: { flex: 1, flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 10 },
    headerMenuBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    headerAvatarWrap: { width: 40, height: 40 },
    headerAvatar:  { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    headerAvatarText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    onlineDot: { position: 'absolute', bottom: -1, right: rtl ? undefined : -1, left: rtl ? -1 : undefined, width: 13, height: 13, borderRadius: 7, backgroundColor: '#22C55E', borderWidth: 2, borderColor: colors.background.surface },
    title:    { fontSize: 16, fontWeight: '800', color: colors.text.primary, textAlign: rtl ? 'right' : 'left' },
    subtitle: { fontSize: 12, color: colors.action.primary, marginTop: 1, textAlign: rtl ? 'right' : 'left' },
    listHeader: { alignItems: 'center', gap: 10, paddingTop: 6, paddingBottom: 8 },
    dateSep:    { alignItems: 'center', marginVertical: 6 },
    // Notification deep-link target, highlighted briefly after the jump.
    focusHighlight: { backgroundColor: 'rgba(31,123,168,0.16)', borderRadius: 12 },
    datePill:   { backgroundColor: colors.background.surface, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 999, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
    datePillText: { fontSize: 12, fontWeight: '700', color: colors.text.muted },
    e2eBanner:  { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FBEFD0', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 14, maxWidth: '88%' },
    e2eBannerText: { fontSize: 12, color: '#92400E', textAlign: 'center', flexShrink: 1 },
    pinBanner: { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#FEF3C7', borderBottomWidth: 1, borderColor: '#F59E0B' },
    pinIcon:   { fontSize: 16 },
    pinTitle:  { fontSize: 11, fontWeight: '700', color: '#A16207', textAlign: rtl ? 'right' : 'left' },
    pinPreview:{ fontSize: 12, color: colors.text.primary, marginTop: 2, textAlign: rtl ? 'right' : 'left' },
    pinClose:  { fontSize: 18, color: '#A16207', fontWeight: '700', paddingHorizontal: 4, minWidth: 32, minHeight: 32, textAlignVertical: 'center', textAlign: 'center' },
    // @mention suggestion list above the composer (capped height; scrolls within).
    mentionList:    { marginHorizontal: 12, marginBottom: 6, maxHeight: 260, backgroundColor: colors.background.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
    mentionScroll:  { maxHeight: 260 },
    mentionRow:     { flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: colors.background.surface },
    mentionRowPressed: { backgroundColor: colors.surface2 },
    // Light-gray separator with a soft drop shadow so it reads as a raised "3D"
    // divider rather than a flat hairline.
    mentionDivider: { height: 1, backgroundColor: '#E2E6EB', marginHorizontal: 12, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 1.5, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
    composerMentionText: { color: colors.action.primary, fontWeight: '800' },
    mentionAvatar:  { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    mentionAvatarImg:  { width: 42, height: 42, borderRadius: 21 },
    mentionAvatarText: { color: '#fff', fontWeight: '800', fontSize: 15 },
    mentionName:    { fontSize: 15, fontWeight: '700', color: colors.text.primary, textAlign: rtl ? 'right' : 'left' },
    mentionSub:     { fontSize: 13, color: colors.text.muted, marginTop: 2, textAlign: rtl ? 'right' : 'left' },
    composerPreview: { marginHorizontal: 12, marginBottom: 6, flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: colors.background.surface, borderRadius: 18, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
    composerPreviewTitle: { fontSize: 11, fontWeight: '700', color: colors.action.primary, textAlign: rtl ? 'right' : 'left' },
    composerPreviewBody:  { fontSize: 12, color: colors.text.primary, marginTop: 2, textAlign: rtl ? 'right' : 'left' },
    composerPreviewClose: { fontSize: 18, color: colors.text.muted, fontWeight: '700', paddingHorizontal: 6, minWidth: 36, minHeight: 36, textAlignVertical: 'center', textAlign: 'center' },
    // The composer is a single floating rounded pill (matching the chat-list
    // bottom tab bar): side margins, a bottom gap, full white surface and a
    // soft shadow. The wallpaper shows through to either side of the pill.
    composer: { marginHorizontal: 12, paddingHorizontal: 6, paddingVertical: 6, flexDirection: rtl ? 'row-reverse' : 'row', gap: 6, alignItems: 'flex-end', backgroundColor: colors.background.surface, borderRadius: 30, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
    // The input region sits transparently inside the floating composer pill.
    inputPill: { flex: 1, flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', minHeight: 46, paddingHorizontal: 4, backgroundColor: 'transparent' },
    pillLeft:  { flex: 1, flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center' },
    recordingInline: { flex: 1, flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, height: 44 },
    recDot:    { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.state.error },
    recTimer:  { fontSize: 13, fontWeight: '700', color: colors.text.primary, minWidth: 42, textAlign: rtl ? 'right' : 'left' },
    recHint:   { flex: 1, fontSize: 12, color: colors.text.muted, textAlign: rtl ? 'left' : 'right' },
    recHintArmed: { color: colors.state.error, fontWeight: '700' },
    input:    { flex: 1, minHeight: 38, maxHeight: 120, paddingHorizontal: 6, paddingVertical: 8, backgroundColor: 'transparent', fontSize: 15, color: colors.text.primary },
    inlineIconLead: { width: 38, height: 44, alignItems: 'center', justifyContent: 'center' },
    inlineIcon: { width: 34, height: 44, alignItems: 'center', justifyContent: 'center' },
    // Big round action button beside the pill (Telegram): blue circle with a
    // white mic (or send arrow once there's text).
    actionCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.action.primary, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
    micWrap:  { width: 48, alignItems: 'center', justifyContent: 'center' },
    micRecording: { transform: [{ scale: 1.35 }], backgroundColor: colors.state.error },
    lockPill: { position: 'absolute', bottom: 60, width: 34, paddingVertical: 8, borderRadius: 18, backgroundColor: colors.background.surface, alignItems: 'center', gap: 4, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
    // Keep the lock pill mounted at all times so the mic node below it never
    // changes child index across the idle↔recording transition (which would
    // drop the active gesture responder). Just hide it when not recording.
    lockPillHidden: { opacity: 0 },
    gate:     { padding: 16, paddingBottom: 28, backgroundColor: '#EAF2FB', borderTopWidth: 1, borderColor: colors.border.subtle },
    gateText: { fontSize: 12, color: colors.text.muted, textAlign: 'center' },
    gateAction: { marginTop: 10, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.action.primary },
    gateActionText: { fontSize: 13, fontWeight: '800', color: colors.action.primaryFg },
  });
}
