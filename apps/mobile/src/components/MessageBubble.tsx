// Phase 6 message bubble.
//
// Renders reply preview, forwarded label, body, edited/deleted indicators,
// pinned glyph, starred glyph, and reaction chips. Long-press exposes the
// action sheet whose entries depend on:
//   - whether the caller is the sender (edit + delete-for-everyone),
//   - whether the message is within EDIT_WINDOW_MS (edit),
//   - whether the message is deleted (most actions hidden),
//   - whether the conversation is a group and the caller is owner/admin
//     (pin in groups, delete-for-everyone of others' messages).
//
// All state writes go through callables. Long-press uses Alert.alert on
// both iOS and Android for now; a richer sheet can land later.

import { useMemo, useState } from 'react';
import {
  View, Text, Pressable, Alert, StyleSheet, Clipboard, Platform,
} from 'react-native';
import { colors } from '../theme';
import {
  Message,
  REACTION_EMOJIS,
  reactToMessage,
  starMessage,
  pinMessage,
  deleteMessage,
  editMessage,
} from '../lib/conversations';

const EDIT_WINDOW_MS = 15 * 60 * 1000;

export type BubbleContext = {
  conversationId: string;
  isGroup:        boolean;
  isMyMessage:    boolean;
  myRoleIsAdmin:  boolean;       // owner or admin in a group
  isStarred:      boolean;
  isPinned:       boolean;
  myUid:          string;
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
};

function createdAtMillis(value: any): number {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  return 0;
}

export function MessageBubble({
  message: m, context, showSender, onReply, onEditStart, onForward, onJumpTo, onInfo, onSendViaSms,
}: MessageBubbleProps) {
  const mine    = context.isMyMessage;
  const deleted = m.deletedForEveryone === true;
  const [reacting, setReacting] = useState(false);

  const canEdit = mine && !deleted && (() => {
    const ms = createdAtMillis(m.createdAt);
    return ms === 0 || Date.now() - ms <= EDIT_WINDOW_MS;
  })();
  const canDeleteForEveryone = !deleted && (mine || (context.isGroup && context.myRoleIsAdmin));
  const canPin = !deleted && (!context.isGroup || context.myRoleIsAdmin);

  const reactionEntries = useMemo(() => {
    if (!m.reactions) return [];
    return Object.entries(m.reactions)
      .filter(([, uids]) => (uids ?? []).length > 0)
      .map(([emoji, uids]) => ({
        emoji,
        count: uids.length,
        mine:  uids.includes(context.myUid),
      }));
  }, [m.reactions, context.myUid]);

  async function copyText() {
    try { (Clipboard as any).setString?.(m.text ?? ''); } catch {}
  }

  async function react(emoji: string) {
    try { await reactToMessage(context.conversationId, m.id, emoji); }
    catch (e: any) { Alert.alert('Couldn’t react', e?.message ?? 'try-again'); }
    finally { setReacting(false); }
  }

  async function toggleStar() {
    try { await starMessage(context.conversationId, m.id, !context.isStarred); }
    catch (e: any) { Alert.alert('Couldn’t update', e?.message ?? 'try-again'); }
  }
  async function togglePin() {
    try { await pinMessage(context.conversationId, m.id, !context.isPinned); }
    catch (e: any) { Alert.alert('Couldn’t update', e?.message ?? 'try-again'); }
  }

  function confirmDelete() {
    const buttons: Array<{ text: string; onPress?: () => void; style?: 'destructive' | 'cancel' }> = [
      { text: 'Delete for me', style: 'destructive', onPress: async () => {
        try { await deleteMessage(context.conversationId, m.id, 'for_me'); }
        catch (e: any) { Alert.alert('Couldn’t delete', e?.message ?? 'try-again'); }
      }},
    ];
    if (canDeleteForEveryone) {
      buttons.push({
        text: 'Delete for everyone', style: 'destructive', onPress: async () => {
          try { await deleteMessage(context.conversationId, m.id, 'for_everyone'); }
          catch (e: any) { Alert.alert('Couldn’t delete', e?.message ?? 'try-again'); }
        },
      });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Delete message', undefined, buttons);
  }

  function openActions() {
    if (deleted) {
      Alert.alert('Deleted message', undefined, [
        { text: 'Message info', onPress: () => onInfo(m) },
        { text: 'Delete for me', style: 'destructive', onPress: () => {
          deleteMessage(context.conversationId, m.id, 'for_me').catch(() => {});
        }},
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    const buttons: Array<{ text: string; onPress?: () => void; style?: 'destructive' | 'cancel' }> = [];
    buttons.push({ text: 'Copy',    onPress: copyText });
    buttons.push({ text: 'Reply',   onPress: () => onReply(m) });
    buttons.push({ text: 'Forward', onPress: () => onForward(m) });
    if (mine && onSendViaSms) {
      buttons.push({ text: 'Send via OfflineSMS', onPress: () => onSendViaSms(m) });
    }
    buttons.push({ text: context.isStarred ? 'Unstar' : 'Star', onPress: toggleStar });
    if (canPin) buttons.push({ text: context.isPinned ? 'Unpin' : 'Pin', onPress: togglePin });
    buttons.push({ text: 'React', onPress: () => setReacting(true) });
    if (canEdit) buttons.push({ text: 'Edit', onPress: () => onEditStart(m) });
    buttons.push({ text: 'Delete', style: 'destructive', onPress: confirmDelete });
    buttons.push({ text: 'Message info', onPress: () => onInfo(m) });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(mine ? 'Your message' : (m.senderDisplayName ?? 'Message'), undefined, buttons);
  }

  return (
    <View style={{ marginBottom: 2 }}>
      {showSender ? (
        <Text style={s.senderLabel}>{m.senderDisplayName ?? m.senderUid.slice(0, 6)}</Text>
      ) : null}

      <Pressable onLongPress={openActions} delayLongPress={300} style={[s.bubble, mine ? s.sent : s.recv]}>
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
          <Text style={[s.bubbleText, mine && { color: '#fff' }, deleted && s.deletedText]}>
            {deleted ? 'This message was deleted.' : (m.text ?? '')}
          </Text>
        </View>

        <View style={s.bubbleFooter}>
          {m.editedAt ? <Text style={[s.foot, mine && { color: 'rgba(255,255,255,.7)' }]}>edited</Text> : null}
          {context.isStarred ? <Text style={s.star}>★</Text> : null}
          {context.isPinned ? <Text style={s.foot}>📌</Text> : null}
          {mine && !deleted ? <ReceiptIndicator message={m} isGroup={context.isGroup} /> : null}
        </View>
      </Pressable>

      {reactionEntries.length > 0 ? (
        <View style={[s.reactionsRow, mine && { justifyContent: 'flex-end' }]}>
          {reactionEntries.map(r => (
            <Pressable key={r.emoji} style={[s.reactionChip, r.mine && s.reactionChipMine]} onPress={() => react(r.emoji)}>
              <Text style={s.reactionEmoji}>{r.emoji}</Text>
              <Text style={s.reactionCount}>{r.count}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {reacting ? (
        <View style={[s.picker, mine && { alignSelf: 'flex-end' }]}>
          {REACTION_EMOJIS.map(e => (
            <Pressable key={e} onPress={() => react(e)} style={s.pickerItem}>
              <Text style={s.pickerEmoji}>{e}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setReacting(false)} style={s.pickerItem}>
            <Text style={s.pickerCancel}>×</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Receipt indicator rendered on the caller's own messages.
 *
 * Direct chats:
 *   no recipient read    → ✓   (sent)
 *   any recipient delivered → ✓✓ (delivered)
 *   any recipient read   → ✓✓ in blue (read)
 * Group chats:
 *   compact counts: '✓ N · 👁 M' for delivered / read.
 */
function ReceiptIndicator({ message, isGroup }: { message: Message; isGroup: boolean }) {
  const delivered = message.deliveredCount ?? 0;
  const read      = message.readCount ?? 0;

  if (isGroup) {
    return (
      <Text style={[s.foot, { color: 'rgba(255,255,255,.85)' }]}>
        ✓ {delivered}  ·  👁 {read}
      </Text>
    );
  }
  // Direct chat: one recipient, so any read => blue double-tick.
  if (read > 0) {
    return <Text style={[s.tick, { color: '#9BD2EE' }]}>✓✓</Text>;
  }
  if (delivered > 0) {
    return <Text style={[s.tick, { color: 'rgba(255,255,255,.85)' }]}>✓✓</Text>;
  }
  return <Text style={[s.tick, { color: 'rgba(255,255,255,.6)' }]}>✓</Text>;
}

const s = StyleSheet.create({
  senderLabel:    { fontSize: 11, fontWeight: '700', color: colors.ink500, marginLeft: 2, marginTop: 4, marginBottom: 2 },
  bubble:         { maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22 },
  sent:           { alignSelf: 'flex-end', backgroundColor: '#1E88E5', borderBottomRightRadius: 8 },
  recv:           { alignSelf: 'flex-start', backgroundColor: '#fff', borderBottomLeftRadius: 8, borderWidth: 1, borderColor: colors.ink100 },
  bubbleRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  bubbleText:     { fontSize: 16, color: colors.ink, lineHeight: 22, flexShrink: 1 },
  deletedText:    { fontStyle: 'italic', color: colors.ink500 },
  meta:           { fontSize: 11, color: colors.ink500, marginBottom: 4, fontWeight: '600' },
  replyPreview:   { borderLeftWidth: 3, borderLeftColor: colors.primaryDark, paddingLeft: 8, marginBottom: 6, backgroundColor: 'rgba(0,0,0,.04)', borderRadius: 6, padding: 6 },
  replyPreviewMine:{ backgroundColor: 'rgba(255,255,255,.16)', borderLeftColor: '#fff' },
  replyName:      { fontSize: 11, fontWeight: '700', color: colors.primaryDark },
  replyText:      { fontSize: 12, color: colors.ink, marginTop: 2 },
  bubbleFooter:   { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6, marginTop: 4 },
  foot:           { fontSize: 10, color: colors.ink500 },
  star:           { fontSize: 10, color: '#F59E0B' },
  tick:           { fontSize: 11, fontWeight: '700', letterSpacing: -1 },
  reactionsRow:   { flexDirection: 'row', gap: 4, marginTop: 4, marginHorizontal: 6 },
  reactionChip:   { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.ink200 },
  reactionChipMine:{ borderColor: colors.primary, backgroundColor: colors.primaryLight },
  reactionEmoji:  { fontSize: 12 },
  reactionCount:  { fontSize: 11, fontWeight: '700', color: colors.ink700 },
  picker:         { flexDirection: 'row', gap: 4, marginTop: 6, padding: 6, backgroundColor: '#fff', borderRadius: 999, borderWidth: 1, borderColor: colors.ink200, alignSelf: 'flex-start' },
  pickerItem:     { paddingHorizontal: 6, paddingVertical: 2 },
  pickerEmoji:    { fontSize: 22 },
  pickerCancel:   { fontSize: 20, color: colors.ink500, fontWeight: '700' },
});
