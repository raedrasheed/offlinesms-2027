// Phase 6 message bubble.
//
// Renders reply preview, forwarded label, body, edited/deleted indicators,
// pinned glyph, starred glyph, and reaction chips. Long-press opens the
// ChatActionSheet (reaction strip + Reply / Forward / Message info / Star /
// Delete) whose entries depend on:
//   - whether the caller is the sender (edit + delete-for-everyone),
//   - whether the message is within EDIT_WINDOW_MS (edit),
//   - whether the message is deleted (most actions hidden),
//   - whether the conversation is a group and the caller is owner/admin
//     (pin in groups, delete-for-everyone of others' messages).
//
// All state writes go through callables.

import { memo, useMemo, useRef, useState } from 'react';
import {
  View, Text, Pressable, Alert, StyleSheet, Clipboard, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { avatarColor, initials } from '../lib/avatar';
import { ChatActionSheet, SheetAction } from './ChatActionSheet';
import { ReactionsSheet, ReactorInfo } from './ReactionsSheet';
import { ImageMessageBubble } from './chat/ImageMessageBubble';
import { VoiceMessageBubble } from './chat/VoiceMessageBubble';
import { AnimatedEmoji3D } from './chat/AnimatedEmoji3D';
import { matchAnimatedEmoji } from '../lib/emoji3d';
import {
  Message,
  REACTION_EMOJIS,
  reactToMessage,
  starMessage,
  pinMessage,
  deleteMessage,
} from '../lib/conversations';
import {
  queueReactMessage,
  queueDeleteMessage,
  queueStarMessage,
  queuePinMessage,
} from '../localdb';

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const SMALL_GROUP_MAX = 20;

export type BubbleContext = {
  conversationId: string;
  isGroup:        boolean;
  isMyMessage:    boolean;
  myRoleIsAdmin:  boolean;       // owner or admin in a group
  isStarred:      boolean;
  isPinned:       boolean;
  myUid:          string;
  memberCount?:   number;
  // uid → display name/photo for resolving who reacted (group members).
  reactorNames?:  Record<string, ReactorInfo>;
  // Phase 22D — when true, actions route through the local outbox instead of
  // calling the callables directly.
  localFirst?:    boolean;
};

export type MessageBubbleProps = {
  message:    Message;
  context:    BubbleContext;
  showSender: boolean;
  onReply:    (msg: Message) => void;
  onEditStart:(msg: Message) => void;
  onForward:  (msg: Message) => void;
  onJumpTo:   (messageId: string) => void;
  onInfo:     (msg: Message) => void;
  onSendViaSms?: (msg: Message) => void;
  onOpenImage?:   (uri: string) => void;
  onRetryMedia?:  (msg: Message) => void;
  onPlayedVoice?: (msg: Message) => void;
  // Offline-first: locally queued outgoing message not yet on the server.
  pending?:   'queued' | 'syncing' | 'failed';
  onRetry?:   () => void;
};

function createdAtMillis(value: any): number {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  return 0;
}

function formatTime(value: any): string {
  const ms = createdAtMillis(value);
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function MessageBubbleImpl({
  message: m, context, showSender, onReply, onEditStart, onForward, onJumpTo, onInfo, onSendViaSms,
  onOpenImage, onRetryMedia, onPlayedVoice, pending, onRetry,
}: MessageBubbleProps) {
  const mine    = context.isMyMessage;
  const deleted = m.deletedForEveryone === true;
  // For images without a caption, overlay time + ticks on the photo (WhatsApp
  // style) instead of below the bubble.
  const imageOverlayFooter = !deleted && m.type === 'image' && !(m.caption && m.caption.trim());
  // Sender avatar/name: message snapshot first, then the resolved member profile.
  const senderProfile = context.reactorNames?.[m.senderUid];
  const senderPhoto = m.senderPhotoURL ?? senderProfile?.photoURL ?? null;
  const senderName = m.senderDisplayName ?? senderProfile?.name ?? m.senderUid.slice(0, 2);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);

  // Memoise per-render allocations so a re-render (e.g. a sibling message
  // changed) doesn't re-compute time strings, re-build the reactions list, or
  // hand a fresh `{uri}` object to <Image> (which would re-mount the avatar).
  const timeText      = useMemo(() => formatTime(m.createdAt), [m.createdAt]);
  // Single-supported-emoji text message → rendered as a big animated 3D emoji.
  const emoji3d       = useMemo(
    () => ((m.type ?? 'text') === 'text' ? matchAnimatedEmoji(m.text) : null),
    [m.type, m.text],
  );
  const senderImgSrc  = useMemo(() => (senderPhoto ? { uri: senderPhoto } : null), [senderPhoto]);

  if (pending) {
    return (
      <Pressable
        style={[{ marginBottom: 2 }]}
        onPress={pending === 'failed' ? onRetry : undefined}
        disabled={pending !== 'failed'}
      >
        <View style={[s.bubble, s.sent, pending !== 'failed' && { opacity: 0.92 }]}>
          <View style={s.bubbleRow}>
            <Text style={[s.bubbleText, { color: '#fff' }]}>{m.text ?? ''}</Text>
          </View>
          <View style={s.bubbleFooter}>
            {pending === 'failed' ? (
              <>
                <Ionicons name="alert-circle" size={12} color="#FFD9D9" />
                <Text style={[s.foot, { color: '#FFD9D9' }]}>Failed · tap to retry</Text>
              </>
            ) : pending === 'syncing' ? (
              <>
                <Ionicons name="sync-outline" size={12} color="rgba(255,255,255,.85)" />
                <Text style={[s.foot, { color: 'rgba(255,255,255,.85)' }]}>Sending…</Text>
              </>
            ) : (
              <>
                <Ionicons name="time-outline" size={12} color="rgba(255,255,255,.85)" />
                <Text style={[s.foot, { color: 'rgba(255,255,255,.85)' }]}>Queued · sends when online</Text>
              </>
            )}
            <Text style={[s.foot, { color: 'rgba(255,255,255,.7)' }]}>{timeText}</Text>
          </View>
        </View>
      </Pressable>
    );
  }

  const canEdit = mine && !deleted && (() => {
    const ms = createdAtMillis(m.createdAt);
    return ms === 0 || Date.now() - ms <= EDIT_WINDOW_MS;
  })();
  const canDeleteForEveryone = !deleted && (mine || (context.isGroup && context.myRoleIsAdmin));
  const canPin = !deleted && (!context.isGroup || context.myRoleIsAdmin);

  const reactionEntries = useMemo(() => {
    if (!m.reactions) return [] as Array<{ emoji: string; count: number; mine: boolean }>;
    return Object.entries(m.reactions)
      .filter(([, uids]) => (uids ?? []).length > 0)
      .map(([emoji, uids]) => ({ emoji, count: uids.length, mine: uids.includes(context.myUid) }));
  }, [m.reactions, context.myUid]);
  const reactionTotal = reactionEntries.reduce((sum, r) => sum + r.count, 0);
  const iReacted = reactionEntries.some(r => r.mine);
  const showAvatar = context.isGroup && !mine;

  function copyText() {
    try { (Clipboard as any).setString?.(m.text ?? ''); } catch {}
  }
  // Busy gate: drop a second tap on the SAME emoji while the first is still
  // in flight. Without this a rapid double-tap fires two toggles back-to-back
  // (the server is idempotent but the local optimistic state visibly flips
  // twice and the outbox churns).
  const reactInFlight = useRef<string | null>(null);
  async function react(emoji: string) {
    if (reactInFlight.current === emoji) return;
    reactInFlight.current = emoji;
    try {
      if (context.localFirst) await queueReactMessage({ conversationId: context.conversationId, messageId: m.id, emoji, uid: context.myUid });
      else await reactToMessage(context.conversationId, m.id, emoji);
    } catch (e: any) { Alert.alert('Couldn’t react', e?.message ?? 'try-again'); }
    finally { reactInFlight.current = null; }
  }
  async function toggleStar() {
    try {
      if (context.localFirst) await queueStarMessage({ conversationId: context.conversationId, messageId: m.id, starred: !context.isStarred });
      else await starMessage(context.conversationId, m.id, !context.isStarred);
    } catch (e: any) { Alert.alert('Couldn’t update', e?.message ?? 'try-again'); }
  }
  async function togglePin() {
    try {
      if (context.localFirst) await queuePinMessage({ conversationId: context.conversationId, messageId: m.id, pinned: !context.isPinned });
      else await pinMessage(context.conversationId, m.id, !context.isPinned);
    } catch (e: any) { Alert.alert('Couldn’t update', e?.message ?? 'try-again'); }
  }
  const del = (mode: 'for_me' | 'for_everyone') =>
    (context.localFirst
      ? queueDeleteMessage({ conversationId: context.conversationId, messageId: m.id, mode })
      : deleteMessage(context.conversationId, m.id, mode)
    ).catch((e: any) => Alert.alert('Couldn’t delete', e?.message ?? 'try-again'));

  function confirmDelete() {
    const buttons: Array<{ text: string; onPress?: () => void; style?: 'destructive' | 'cancel' }> = [
      { text: 'Delete for me', style: 'destructive', onPress: () => { void del('for_me'); } },
    ];
    if (canDeleteForEveryone) {
      buttons.push({ text: 'Delete for everyone', style: 'destructive', onPress: () => { void del('for_everyone'); } });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Delete message', undefined, buttons);
  }

  const close = () => setSheetOpen(false);
  const sheetActions: SheetAction[] = deleted
    ? [
        { key: 'info',  label: 'Message info',  icon: 'information-circle-outline', highlighted: true, onPress: () => { close(); onInfo(m); } },
        { key: 'delme', label: 'Delete for me', icon: 'trash-outline', destructive: true, onPress: () => { close(); deleteMessage(context.conversationId, m.id, 'for_me').catch(() => {}); } },
      ]
    : [
        { key: 'reply',   label: 'Reply',   icon: 'arrow-undo-outline', onPress: () => { close(); onReply(m); } },
        { key: 'forward', label: 'Forward', icon: 'arrow-redo-outline', onPress: () => { close(); onForward(m); } },
        { key: 'copy',    label: 'Copy',    icon: 'copy-outline', onPress: () => { close(); copyText(); } },
        { key: 'star',    label: context.isStarred ? 'Unstar' : 'Star', icon: context.isStarred ? 'star' : 'star-outline', onPress: () => { close(); toggleStar(); } },
        ...(canPin ? [{ key: 'pin', label: context.isPinned ? 'Unpin' : 'Pin', icon: 'pin-outline', onPress: () => { close(); togglePin(); } } as SheetAction] : []),
        ...(canEdit ? [{ key: 'edit', label: 'Edit', icon: 'create-outline', onPress: () => { close(); onEditStart(m); } } as SheetAction] : []),
        ...(mine && onSendViaSms ? [{ key: 'sms', label: 'Send via OfflineSMS', icon: 'paper-plane-outline', onPress: () => { close(); onSendViaSms(m); } } as SheetAction] : []),
        { key: 'info',   label: 'Message info', icon: 'information-circle-outline', highlighted: true, onPress: () => { close(); onInfo(m); } },
        { key: 'delete', label: 'Delete', icon: 'trash-outline', destructive: true, onPress: () => { close(); confirmDelete(); } },
      ];

  return (
    <View style={[s.row, mine ? s.rowMine : s.rowTheirs]}>
      {showAvatar ? (
        showSender ? (
          senderPhoto ? (
            <Image source={senderImgSrc!} style={s.avatar} />
          ) : (
            <View style={[s.avatar, { backgroundColor: avatarColor(m.senderUid) }]}>
              <Text style={s.avatarText}>{initials(senderName)}</Text>
            </View>
          )
        ) : (
          <View style={s.avatarSpacer} />
        )
      ) : null}

      <View style={[s.col, mine ? s.colMine : s.colTheirs]}>
      <Pressable onLongPress={() => setSheetOpen(true)} delayLongPress={300} style={[s.bubble, mine ? s.sent : s.recv]}>
        {showSender ? (
          <Text style={[s.senderLabel, { color: avatarColor(m.senderUid) }]} numberOfLines={1}>
            {senderName}
          </Text>
        ) : null}
        {m.forwarded ? <Text style={[s.meta, mine && { color: 'rgba(255,255,255,.85)' }]}>↪︎ Forwarded</Text> : null}

        {m.replyTo ? (
          <Pressable
            onPress={() => onJumpTo(m.replyTo!.messageId)}
            style={[s.replyPreview, mine && s.replyPreviewMine]}
          >
            <Text style={[s.replyName, mine && { color: '#fff' }]} numberOfLines={1}>
              {m.replyTo.senderDisplayName || m.replyTo.senderUid.slice(0, 6)}
            </Text>
            <Text style={[s.replyText, mine && { color: 'rgba(255,255,255,.85)' }]} numberOfLines={2}>
              {m.replyTo.preview}
            </Text>
          </Pressable>
        ) : null}

        {!deleted && m.type === 'image' ? (
          <ImageMessageBubble
            message={m}
            mine={mine}
            onOpen={(uri) => onOpenImage?.(uri)}
            onRetry={() => onRetryMedia?.(m)}
            footer={imageOverlayFooter ? (
              <>
                <Text style={s.imgFootTime}>{timeText}</Text>
                {mine ? <ReceiptIndicator message={m} isGroup={context.isGroup} memberCount={context.memberCount} /> : null}
              </>
            ) : null}
          />
        ) : !deleted && m.type === 'voice' ? (
          <VoiceMessageBubble
            message={m}
            mine={mine}
            onPlayed={() => onPlayedVoice?.(m)}
            onRetry={() => onRetryMedia?.(m)}
          />
        ) : !deleted && emoji3d ? (
          // Single-emoji message → large animated 3D emoji (WhatsApp style).
          <View style={s.emoji3dWrap}>
            <AnimatedEmoji3D emoji={emoji3d} size={96} />
          </View>
        ) : (
          <View style={s.bubbleRow}>
            <Text style={[s.bubbleText, mine && { color: '#fff' }, deleted && (mine ? s.deletedTextMine : s.deletedText)]}>
              {deleted ? 'This message was deleted.' : (m.text ?? '')}
            </Text>
          </View>
        )}

        {imageOverlayFooter ? null : (
          <View style={s.bubbleFooter}>
            {m.editedAt ? <Text style={[s.foot, mine && { color: 'rgba(255,255,255,.7)' }]}>edited</Text> : null}
            {context.isStarred ? <Text style={s.star}>★</Text> : null}
            {context.isPinned ? <Text style={s.foot}>📌</Text> : null}
            {mine && !deleted ? (
              <ReceiptIndicator message={m} isGroup={context.isGroup} memberCount={context.memberCount} />
            ) : null}
            <Text style={[s.foot, mine && { color: 'rgba(255,255,255,.7)' }]}>{timeText}</Text>
          </View>
        )}
      </Pressable>

      {reactionEntries.length > 0 ? (
        <Pressable
          style={[s.reactionPill, iReacted && s.reactionPillMine]}
          onPress={() => (context.isGroup ? setReactionsOpen(true) : setSheetOpen(true))}
        >
          {reactionEntries.map(r => (
            <Text key={r.emoji} style={s.reactionEmoji}>{r.emoji}</Text>
          ))}
          {reactionTotal > 1 ? <Text style={s.reactionCount}>{reactionTotal}</Text> : null}
        </Pressable>
      ) : null}
      </View>

      <ChatActionSheet
        visible={sheetOpen}
        onClose={close}
        mine={mine}
        previewText={deleted ? 'This message was deleted.' : (m.text ?? '')}
        reactions={deleted ? [] : REACTION_EMOJIS}
        onReact={(e) => { close(); react(e); }}
        actions={sheetActions}
      />

      <ReactionsSheet
        visible={reactionsOpen}
        onClose={() => setReactionsOpen(false)}
        reactions={m.reactions}
        myUid={context.myUid}
        resolveName={(uid) =>
          context.reactorNames?.[uid] ??
          (uid === context.myUid ? { name: 'You' } : { name: uid.slice(0, 6) })
        }
        onRemoveMine={(emoji) => { void react(emoji); }}
      />
    </View>
  );
}

/**
 * Receipt indicator on the caller's own messages.
 *
 * Direct chats:  ✓ sent · ✓✓ delivered · ✓✓ blue read
 * Small groups (< 20): eye + "Seen by N"
 * Larger groups: ✓✓ delivered count · eye read count
 */
function ReceiptIndicator({ message, isGroup, memberCount }: { message: Message; isGroup: boolean; memberCount?: number }) {
  const delivered = message.deliveredCount ?? 0;
  const read      = message.readCount ?? 0;

  if (isGroup) {
    if (memberCount && memberCount < SMALL_GROUP_MAX) {
      return (
        <View style={s.receiptRow}>
          <Ionicons name="eye-outline" size={12} color="rgba(255,255,255,.85)" />
          <Text style={[s.foot, { color: 'rgba(255,255,255,.85)' }]}>Seen by {read}</Text>
        </View>
      );
    }
    return (
      <View style={s.receiptRow}>
        <Ionicons name="checkmark-done" size={13} color="rgba(255,255,255,.85)" />
        <Text style={[s.foot, { color: 'rgba(255,255,255,.85)' }]}>{delivered}</Text>
        <Ionicons name="eye-outline" size={12} color="rgba(255,255,255,.85)" />
        <Text style={[s.foot, { color: 'rgba(255,255,255,.85)' }]}>{read}</Text>
      </View>
    );
  }
  if (read > 0)      return <Text style={[s.tick, { color: '#9BD2EE' }]}>✓✓</Text>;
  if (delivered > 0) return <Text style={[s.tick, { color: 'rgba(255,255,255,.85)' }]}>✓✓</Text>;
  return <Text style={[s.tick, { color: 'rgba(255,255,255,.6)' }]}>✓</Text>;
}

const s = StyleSheet.create({
  row:            { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 2 },
  rowMine:        { justifyContent: 'flex-end' },
  rowTheirs:      { justifyContent: 'flex-start' },
  col:            { maxWidth: '80%' },
  colMine:        { alignItems: 'flex-end' },
  colTheirs:      { alignItems: 'flex-start' },
  avatar:         { width: 30, height: 30, borderRadius: 15, marginRight: 6, marginTop: 2, alignItems: 'center', justifyContent: 'center' },
  avatarText:     { color: '#fff', fontWeight: '800', fontSize: 12 },
  avatarSpacer:   { width: 36 },
  senderLabel:    { fontSize: 12, fontWeight: '800', marginBottom: 2 },
  bubble:         { maxWidth: '100%', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 18, shadowColor: '#000', shadowOpacity: 0.10, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  sent:           { backgroundColor: '#1E88E5', borderTopRightRadius: 5 },
  recv:           { backgroundColor: '#fff', borderTopLeftRadius: 5 },
  bubbleRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  emoji3dWrap:    { alignItems: 'center', justifyContent: 'center', paddingVertical: 4, paddingHorizontal: 8 },
  bubbleText:     { fontSize: 16, color: colors.ink, lineHeight: 22, flexShrink: 1 },
  deletedText:    { fontStyle: 'italic', color: colors.ink500 },
  deletedTextMine:{ fontStyle: 'italic', color: 'rgba(255,255,255,.8)' },
  meta:           { fontSize: 11, color: colors.ink500, marginBottom: 4, fontWeight: '600' },
  replyPreview:   { borderLeftWidth: 3, borderLeftColor: colors.primaryDark, paddingLeft: 8, marginBottom: 6, backgroundColor: 'rgba(0,0,0,.04)', borderRadius: 6, padding: 6 },
  replyPreviewMine:{ backgroundColor: 'rgba(255,255,255,.16)', borderLeftColor: '#fff' },
  replyName:      { fontSize: 11, fontWeight: '700', color: colors.primaryDark },
  replyText:      { fontSize: 12, color: colors.ink, marginTop: 2 },
  bubbleFooter:   { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6, marginTop: 4 },
  foot:           { fontSize: 10, color: colors.ink500 },
  imgFootTime:    { fontSize: 11, color: '#fff', fontWeight: '600' },
  receiptRow:     { flexDirection: 'row', alignItems: 'center', gap: 3 },
  star:           { fontSize: 10, color: '#F59E0B' },
  tick:           { fontSize: 11, fontWeight: '700', letterSpacing: -1 },
  reactionPill:   { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: '#fff', marginTop: -11, marginHorizontal: 12, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 2.5, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  reactionPillMine:{ backgroundColor: colors.primaryLight },
  reactionEmoji:  { fontSize: 13 },
  reactionCount:  { fontSize: 12, fontWeight: '700', color: colors.ink700, marginLeft: 2 },
});

// Precise equality so a parent re-render only re-renders bubbles whose data
// actually changed. We compare specific message fields (reference compare for
// nested objects: Firestore returns a new reactions/media object when those
// change). Callback identity is expected to be stable from the parent — that's
// what commit 2 sets up via useCallback.
function areBubblePropsEqual(prev: MessageBubbleProps, next: MessageBubbleProps): boolean {
  if (prev.showSender !== next.showSender) return false;
  if (prev.pending    !== next.pending)    return false;

  // Callbacks (parent stabilises them).
  if (prev.onReply       !== next.onReply)       return false;
  if (prev.onEditStart   !== next.onEditStart)   return false;
  if (prev.onForward     !== next.onForward)     return false;
  if (prev.onJumpTo      !== next.onJumpTo)      return false;
  if (prev.onInfo        !== next.onInfo)        return false;
  if (prev.onSendViaSms  !== next.onSendViaSms)  return false;
  if (prev.onOpenImage   !== next.onOpenImage)   return false;
  if (prev.onRetryMedia  !== next.onRetryMedia)  return false;
  if (prev.onPlayedVoice !== next.onPlayedVoice) return false;
  if (prev.onRetry       !== next.onRetry)       return false;

  const a = prev.message, b = next.message;
  if (a !== b) {
    if (a.id !== b.id) return false;
    if ((a as any).text !== (b as any).text) return false;
    if ((a as any).caption !== (b as any).caption) return false;
    if (a.type !== b.type) return false;
    if (a.deletedForEveryone !== b.deletedForEveryone) return false;
    if ((a as any).updatedAt !== (b as any).updatedAt) return false;
    if ((a as any).editedAt !== (b as any).editedAt) return false;
    if ((a as any).status !== (b as any).status) return false;
    if (a.reactions     !== b.reactions)     return false; // ref compare
    if ((a as any).pinnedBy  !== (b as any).pinnedBy)  return false;
    if ((a as any).starredBy !== (b as any).starredBy) return false;
    if ((a as any).media     !== (b as any).media)     return false; // media + upload progress
    if ((a as any).replyTo   !== (b as any).replyTo)   return false;
    if ((a as any).forwardedFrom !== (b as any).forwardedFrom) return false;
    if (a.senderPhotoURL    !== b.senderPhotoURL)    return false;
    if (a.senderDisplayName !== b.senderDisplayName) return false;
  }

  const c = prev.context, d = next.context;
  if (c !== d) {
    if (c.conversationId !== d.conversationId) return false;
    if (c.isGroup        !== d.isGroup)        return false;
    if (c.isMyMessage    !== d.isMyMessage)    return false;
    if (c.myRoleIsAdmin  !== d.myRoleIsAdmin)  return false;
    if (c.isStarred      !== d.isStarred)      return false;
    if (c.isPinned       !== d.isPinned)       return false;
    if (c.myUid          !== d.myUid)          return false;
    if (c.memberCount    !== d.memberCount)    return false;
    if (c.reactorNames   !== d.reactorNames)   return false; // ref compare
    if (c.localFirst     !== d.localFirst)     return false;
  }

  return true;
}

export const MessageBubble = memo(MessageBubbleImpl, areBubblePropsEqual);
