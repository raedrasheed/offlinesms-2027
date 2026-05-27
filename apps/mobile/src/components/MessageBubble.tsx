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

import { useState } from 'react';
import {
  View, Text, Pressable, Alert, StyleSheet, Clipboard, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { avatarColor, initials } from '../lib/avatar';
import { ChatActionSheet, SheetAction } from './ChatActionSheet';
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

export function MessageBubble({
  message: m, context, showSender, onReply, onEditStart, onForward, onJumpTo, onInfo, onSendViaSms, pending, onRetry,
}: MessageBubbleProps) {
  const mine    = context.isMyMessage;
  const deleted = m.deletedForEveryone === true;
  const [sheetOpen, setSheetOpen] = useState(false);

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
            <Text style={[s.foot, { color: 'rgba(255,255,255,.7)' }]}>{formatTime(m.createdAt)}</Text>
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

  const reactionEntries = (() => {
    if (!m.reactions) return [] as Array<{ emoji: string; count: number; mine: boolean }>;
    return Object.entries(m.reactions)
      .filter(([, uids]) => (uids ?? []).length > 0)
      .map(([emoji, uids]) => ({ emoji, count: uids.length, mine: uids.includes(context.myUid) }));
  })();
  const reactionTotal = reactionEntries.reduce((sum, r) => sum + r.count, 0);
  const iReacted = reactionEntries.some(r => r.mine);
  const showAvatar = context.isGroup && !mine;

  function copyText() {
    try { (Clipboard as any).setString?.(m.text ?? ''); } catch {}
  }
  async function react(emoji: string) {
    try {
      if (context.localFirst) await queueReactMessage({ conversationId: context.conversationId, messageId: m.id, emoji, uid: context.myUid });
      else await reactToMessage(context.conversationId, m.id, emoji);
    } catch (e: any) { Alert.alert('Couldn’t react', e?.message ?? 'try-again'); }
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
          m.senderPhotoURL ? (
            <Image source={{ uri: m.senderPhotoURL }} style={s.avatar} />
          ) : (
            <View style={[s.avatar, { backgroundColor: avatarColor(m.senderUid) }]}>
              <Text style={s.avatarText}>{initials(m.senderDisplayName ?? m.senderUid.slice(0, 2))}</Text>
            </View>
          )
        ) : (
          <View style={s.avatarSpacer} />
        )
      ) : null}

      <View style={[s.col, mine ? s.colMine : s.colTheirs]}>
      {showSender ? (
        <Text style={s.senderLabel}>{m.senderDisplayName ?? m.senderUid.slice(0, 6)}</Text>
      ) : null}

      <Pressable onLongPress={() => setSheetOpen(true)} delayLongPress={300} style={[s.bubble, mine ? s.sent : s.recv]}>
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

        <View style={s.bubbleRow}>
          <Text style={[s.bubbleText, mine && { color: '#fff' }, deleted && (mine ? s.deletedTextMine : s.deletedText)]}>
            {deleted ? 'This message was deleted.' : (m.text ?? '')}
          </Text>
        </View>

        <View style={s.bubbleFooter}>
          {m.editedAt ? <Text style={[s.foot, mine && { color: 'rgba(255,255,255,.7)' }]}>edited</Text> : null}
          {context.isStarred ? <Text style={s.star}>★</Text> : null}
          {context.isPinned ? <Text style={s.foot}>📌</Text> : null}
          {mine && !deleted ? (
            <ReceiptIndicator message={m} isGroup={context.isGroup} memberCount={context.memberCount} />
          ) : null}
          <Text style={[s.foot, mine && { color: 'rgba(255,255,255,.7)' }]}>{formatTime(m.createdAt)}</Text>
        </View>
      </Pressable>

      {reactionEntries.length > 0 ? (
        <Pressable
          style={[s.reactionPill, iReacted && s.reactionPillMine]}
          onPress={() => setSheetOpen(true)}
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
  avatar:         { width: 30, height: 30, borderRadius: 15, marginRight: 6, marginTop: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText:     { color: '#fff', fontWeight: '800', fontSize: 12 },
  avatarSpacer:   { width: 36 },
  senderLabel:    { fontSize: 11, fontWeight: '700', color: colors.ink500, marginLeft: 2, marginTop: 4, marginBottom: 2 },
  bubble:         { maxWidth: '100%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22, shadowColor: '#000', shadowOpacity: 0.10, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  sent:           { backgroundColor: '#1E88E5', borderBottomRightRadius: 8 },
  recv:           { backgroundColor: '#fff', borderBottomLeftRadius: 8 },
  bubbleRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
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
  receiptRow:     { flexDirection: 'row', alignItems: 'center', gap: 3 },
  star:           { fontSize: 10, color: '#F59E0B' },
  tick:           { fontSize: 11, fontWeight: '700', letterSpacing: -1 },
  reactionPill:   { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: '#fff', marginTop: -11, marginHorizontal: 12, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 2.5, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  reactionPillMine:{ backgroundColor: colors.primaryLight },
  reactionEmoji:  { fontSize: 13 },
  reactionCount:  { fontSize: 12, fontWeight: '700', color: colors.ink700, marginLeft: 2 },
});
