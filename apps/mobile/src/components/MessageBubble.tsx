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
import { useTranslation } from 'react-i18next';
import { colors } from '../theme';
import { avatarColor, initials } from '../lib/avatar';
import { useDisplayNames } from '../lib/userProfiles';
import { LinkText } from './LinkText';
import { MentionText } from './MentionText';
import { ChatActionSheet, SheetAction } from './ChatActionSheet';
import { ReactionsSheet, ReactorInfo } from './ReactionsSheet';
import { EmojiReactionPicker } from './chat/EmojiReactionPicker';
import { ImageMessageBubble } from './chat/ImageMessageBubble';
import { VideoMessageBubble } from './chat/VideoMessageBubble';
import { AttachmentMessageBubble } from './chat/AttachmentMessageBubble';
import { VoiceMessageBubble } from './chat/VoiceMessageBubble';
import { AnimatedEmoji3D } from './chat/AnimatedEmoji3D';
import { StickerBubble } from './chat/StickerBubble';
import { PollBubble } from './chat/PollBubble';
import { matchAnimatedEmoji } from '../lib/emoji3d';
import {
  Message,
  REACTION_EMOJIS,
  reactToMessage,
  starMessage,
  pinMessage,
  deleteMessage,
  votePoll,
  closePoll,
} from '../lib/conversations';
import {
  queueReactMessage,
  queueDeleteMessage,
  queueStarMessage,
  queuePinMessage,
  queueVotePoll,
  queueClosePoll,
} from '../localdb';

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const SMALL_GROUP_MAX = 20;
// Telegram light-theme accents for the sent (green) bubble.
const TG_GREEN      = '#5FA84E';
const TG_GREEN_DARK = '#3E7B33';

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
  // Group chat: tap a sender's avatar to open their member-info sheet.
  onAvatarPress?: (uid: string) => void;
  // Tap a highlighted @mention to open that member's info.
  onMentionPress?: (uid: string) => void;
  onOpenContact?: (uid: string) => Promise<void>;
  // Offline-first: locally queued outgoing message not yet on the server.
  pending?:   'queued' | 'syncing' | 'failed';
  onRetry?:   (message: Message) => void;
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
  onOpenImage, onRetryMedia, onPlayedVoice, onAvatarPress, onMentionPress, onOpenContact, pending, onRetry,
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const mine    = context.isMyMessage;
  const deleted = m.deletedForEveryone === true;
  // Photos and videos use the same card and overlay receipts when captionless.
  const mediaMessage = !deleted && (m.type === 'image' || m.type === 'video');
  const mediaOverlayFooter = mediaMessage && !m.caption?.trim();
  // Sender avatar/name. Prefer the resolved member profile (kept in sync with
  // the live user photo) over the per-message snapshot: the snapshot is frozen
  // at send time and goes stale once the sender changes their picture, leaving
  // a broken URL that renders as an invisible avatar. The snapshot is only a
  // fallback for when the profile hasn't resolved (e.g. a left member).
  const senderProfile = context.reactorNames?.[m.senderUid];
  const senderPhoto = senderProfile?.photoURL ?? m.senderPhotoURL ?? null;
  // Names come from the shared resolver (live profile → snapshot while
  // loading → "Unknown user"), never from the uid. The reply author is
  // resolved from replyTo.senderUid so OLD replies that persisted a uid
  // fragment as senderDisplayName still show the real name.
  const replyUid = m.replyTo?.senderUid || null;
  const nameFor = useDisplayNames([m.senderUid, replyUid]);
  const senderName = nameFor(m.senderUid, { snapshot: [m.senderDisplayName, senderProfile?.name] });
  const replyAuthor = m.replyTo
    ? nameFor(replyUid, { snapshot: m.replyTo.senderDisplayName, selfAsYou: true })
    : '';
  const [sheetOpen, setSheetOpen] = useState(false);
  // Track a photo URL that failed to load so we can fall back to the initials
  // placeholder instead of leaving a blank gap. Keyed by URL so a new/updated
  // photo is retried rather than permanently suppressed.
  const [avatarErrorUri, setAvatarErrorUri] = useState<string | null>(null);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiReplay, setEmojiReplay] = useState(0);

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
  // Media (image/video) bubbles get a light-gray card frame; emoji bubbles
  // are chromeless (transparent — the 3D emoji floats on the wallpaper).
  // Stickers float on the wallpaper like the big 3D emoji (no bubble chrome).
  const stickerMessage    = !deleted && m.type === 'sticker';
  const transparentBubble = !deleted && (!!emoji3d || stickerMessage);
  const richKind          = m.type === 'sticker' || m.type === 'poll';
  // Footer tone: white inside the emoji pill (sits on the wallpaper), ink on
  // the gray media card, Telegram green on the sent bubble, default gray on
  // received bubbles. Both bubble colors are light, so text is always dark.
  const footColor = transparentBubble
    ? { color: 'rgba(255,255,255,0.95)' }
    : mediaMessage
      ? { color: colors.ink500 }
      : (mine ? { color: TG_GREEN } : undefined);
  const receiptTone: ReceiptTone = transparentBubble ? 'white' : mediaMessage ? 'ink' : 'green';

  if (pending) {
    // Same row/column wrappers as a normal sent bubble so it hugs its content,
    // caps at 80% width, and right-aligns — instead of stretching full width.
    return (
      <View style={[s.row, s.rowMine]}>
        <View style={[s.col, s.colMine]}>
          <Pressable
            style={{ marginBottom: 2 }}
            onPress={pending === 'failed' ? () => onRetry?.(m) : undefined}
            disabled={pending !== 'failed'}
          >
            <View style={[s.bubble, s.sent, pending !== 'failed' && { opacity: 0.92 }]}>
              {m.type === 'poll' && m.poll ? (
                <PollBubble poll={m.poll} me={context.myUid} isCreator={false} mine={mine}
                  interactive={false} onVote={() => {}} onClose={() => {}} />
              ) : m.type === 'sticker' ? <StickerBubble sticker={m.sticker} fallbackText={m.text} /> : (
                <View style={s.bubbleRow}>
                  <Text style={s.bubbleText}>{m.text ?? ''}</Text>
                </View>
              )}
              <View style={s.bubbleFooter}>
                {pending === 'failed' ? (
                  <>
                    <Ionicons name="alert-circle" size={12} color={colors.err} />
                    <Text style={[s.foot, { color: colors.err }]}>Failed · tap to retry</Text>
                  </>
                ) : pending === 'syncing' ? (
                  <>
                    <Ionicons name="sync-outline" size={12} color={TG_GREEN} />
                    <Text style={[s.foot, { color: TG_GREEN }]}>Sending…</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="time-outline" size={12} color={TG_GREEN} />
                    <Text style={[s.foot, { color: TG_GREEN }]}>Queued · sends when online</Text>
                  </>
                )}
                <Text style={[s.foot, { color: TG_GREEN }]}>{timeText}</Text>
              </View>
            </View>
          </Pressable>
        </View>
      </View>
    );
  }

  const canEdit = mine && !deleted && (m.type ?? 'text') === 'text' && (() => {
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

  function vote(selection: string[]) {
    if (context.localFirst) {
      void queueVotePoll({ conversationId: context.conversationId, messageId: m.id, uid: context.myUid, optionIds: selection })
        .then(r => {
          if (!r.ok && r.reason === 'not-initialised') {
            votePoll(context.conversationId, m.id, selection).catch(e => Alert.alert('Poll', e?.message ?? 'try-again'));
          }
        });
    } else {
      votePoll(context.conversationId, m.id, selection).catch(e => Alert.alert('Poll', e?.message ?? 'try-again'));
    }
  }
  function confirmClosePoll() {
    Alert.alert(t('poll.endTitle'), t('poll.endBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('poll.end'), style: 'destructive', onPress: () => {
        const action = context.localFirst
          ? queueClosePoll({ conversationId: context.conversationId, messageId: m.id }).then(result => {
            if (!result.ok) throw new Error(result.reason);
          })
          : closePoll(context.conversationId, m.id);
        action.catch(e => Alert.alert(t('poll.endTitle'), e?.message ?? 'try-again'));
      } },
    ]);
  }

  const close = () => setSheetOpen(false);
  const sheetActions: SheetAction[] = deleted
    ? [
        { key: 'info',  label: 'Message info',  icon: 'information-circle-outline', highlighted: true, onPress: () => { close(); onInfo(m); } },
        { key: 'delme', label: 'Delete for me', icon: 'trash-outline', destructive: true, onPress: () => { close(); deleteMessage(context.conversationId, m.id, 'for_me').catch(() => {}); } },
      ]
    : [
        { key: 'reply',   label: 'Reply',   icon: 'arrow-undo-outline', onPress: () => { close(); onReply(m); } },
        ...(!richKind ? [
          ...(!m.media || m.media.uploadStatus === 'uploaded' ? [{ key: 'forward', label: 'Forward', icon: 'arrow-redo-outline', onPress: () => { close(); onForward(m); } } as SheetAction] : []),
          { key: 'copy',    label: 'Copy',    icon: 'copy-outline', onPress: () => { close(); copyText(); } } as SheetAction,
        ] : []),
        { key: 'star',    label: context.isStarred ? 'Unstar' : 'Star', icon: context.isStarred ? 'star' : 'star-outline', onPress: () => { close(); toggleStar(); } },
        ...(canPin ? [{ key: 'pin', label: context.isPinned ? 'Unpin' : 'Pin', icon: 'pin-outline', onPress: () => { close(); togglePin(); } } as SheetAction] : []),
        ...(canEdit ? [{ key: 'edit', label: 'Edit', icon: 'create-outline', onPress: () => { close(); onEditStart(m); } } as SheetAction] : []),
        ...(mine && onSendViaSms && (m.type === 'text' || m.type === 'location' || m.type === 'contact') ? [{ key: 'sms', label: 'Send via OfflineSMS', icon: 'paper-plane-outline', onPress: () => { close(); onSendViaSms(m); } } as SheetAction] : []),
        { key: 'info',   label: 'Message info', icon: 'information-circle-outline', highlighted: true, onPress: () => { close(); onInfo(m); } },
        { key: 'delete', label: 'Delete', icon: 'trash-outline', destructive: true, onPress: () => { close(); confirmDelete(); } },
      ];

  return (
    <View style={[s.row, mine ? s.rowMine : s.rowTheirs]}>
      {showAvatar ? (
        showSender ? (
          <Pressable
            onPress={onAvatarPress ? () => onAvatarPress(m.senderUid) : undefined}
            disabled={!onAvatarPress}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`${senderName} info`}
          >
            {senderPhoto && avatarErrorUri !== senderPhoto ? (
              <Image
                source={senderImgSrc!}
                style={s.avatar}
                onError={() => setAvatarErrorUri(senderPhoto)}
              />
            ) : (
              <View style={[s.avatar, { backgroundColor: avatarColor(m.senderUid) }]}>
                <Text style={s.avatarText}>{initials(senderName)}</Text>
              </View>
            )}
          </Pressable>
        ) : (
          <View style={s.avatarSpacer} />
        )
      ) : null}

      <View style={[s.col, mine ? s.colMine : s.colTheirs]}>
      <Pressable
        onLongPress={() => setSheetOpen(true)}
        delayLongPress={300}
        style={[
          s.bubble,
          transparentBubble ? s.bubbleEmoji : mediaMessage ? s.bubbleMedia : mine ? s.sent : s.recv,
        ]}
      >
        {showSender ? (
          <Text style={[s.senderLabel, { color: avatarColor(m.senderUid) }]} numberOfLines={1}>
            {senderName}
          </Text>
        ) : null}
        {m.forwarded ? <Text style={s.meta}>↪︎ Forwarded</Text> : null}

        {m.replyTo ? (
          <Pressable
            onPress={() => onJumpTo(m.replyTo!.messageId)}
            style={[s.replyPreview, mine && !mediaMessage && s.replyPreviewMine]}
          >
            <Text style={[s.replyName, mine && !mediaMessage && s.replyNameMine]} numberOfLines={1}>
              {replyAuthor}
            </Text>
            <Text style={s.replyText} numberOfLines={2}>
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
            onLongPress={() => setSheetOpen(true)}
            footer={mediaOverlayFooter ? (
              <>
                <Text style={s.imgFootTime}>{timeText}</Text>
                {mine ? <ReceiptIndicator message={m} isGroup={context.isGroup} memberCount={context.memberCount} tone="white" /> : null}
              </>
            ) : null}
          />
        ) : !deleted && m.type === 'video' ? (
          <VideoMessageBubble key={m.id} message={m} mine={mine}
            onRetry={() => onRetryMedia?.(m)} onLongPress={() => setSheetOpen(true)}
            footer={mediaOverlayFooter ? <>
              <Text style={s.imgFootTime}>{timeText}</Text>
              {mine ? <ReceiptIndicator message={m} isGroup={context.isGroup} memberCount={context.memberCount} tone="white"/> : null}
            </> : null}/>
        ) : !deleted && m.type === 'voice' ? (
          <VoiceMessageBubble
            message={m}
            mine={mine}
            onPlayed={() => onPlayedVoice?.(m)}
            onRetry={() => onRetryMedia?.(m)}
          />
        ) : !deleted && ['file','audio','location','contact'].includes(m.type) ? (
          <AttachmentMessageBubble message={m} mine={mine} myUid={context.myUid} onOpenContact={onOpenContact} onRetry={() => onRetryMedia?.(m)} onLongPress={() => setSheetOpen(true)}/>
        ) : stickerMessage ? (
          <Pressable
            onLongPress={() => setSheetOpen(true)}
            delayLongPress={300}
            accessibilityRole="image"
          >
            <StickerBubble sticker={m.sticker} fallbackText={m.text} />
          </Pressable>
        ) : !deleted && m.type === 'poll' && m.poll ? (
          <PollBubble
            poll={m.poll}
            me={context.myUid}
            isCreator={mine}
            mine={mine}
            onVote={vote}
            onClose={confirmClosePoll}
          />
        ) : !deleted && emoji3d ? (
          // Single-emoji message → large animated 3D emoji (WhatsApp style).
          // Tap replays a bigger pop of the animation; long-press still opens
          // the message action sheet.
          <Pressable
            style={s.emoji3dWrap}
            onPress={() => setEmojiReplay(k => k + 1)}
            onLongPress={() => setSheetOpen(true)}
            delayLongPress={300}
            accessibilityRole="button"
            accessibilityLabel={emoji3d.char}
          >
            <AnimatedEmoji3D emoji={emoji3d} size={96} replayTrigger={emojiReplay} />
          </Pressable>
        ) : (
          <View style={s.bubbleRow}>
            {deleted ? (
              <Text style={[s.bubbleText, s.deletedText]}>This message was deleted.</Text>
            ) : (
              <MentionText
                style={s.bubbleText}
                text={m.text ?? ''}
                mentions={m.mentions}
                onMentionPress={onMentionPress}
              />
            )}
          </View>
        )}

        {mediaOverlayFooter ? null : (
          <View style={[s.bubbleFooter, transparentBubble && s.bubbleFooterEmoji]}>
            {m.editedAt ? <Text style={[s.foot, footColor]}>edited</Text> : null}
            {context.isStarred ? <Text style={s.star}>★</Text> : null}
            {context.isPinned ? <Text style={s.foot}>📌</Text> : null}
            {mine && !deleted ? (
              <ReceiptIndicator message={m} isGroup={context.isGroup} memberCount={context.memberCount} tone={receiptTone} />
            ) : null}
            <Text style={[s.foot, footColor]}>{timeText}</Text>
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
        onMore={deleted ? undefined : () => { close(); setEmojiPickerOpen(true); }}
        actions={sheetActions}
      />

      <EmojiReactionPicker
        uid={context.myUid}
        visible={emojiPickerOpen}
        onClose={() => setEmojiPickerOpen(false)}
        onSelect={(e) => { setEmojiPickerOpen(false); react(e); }}
      />

      <ReactionsSheet
        visible={reactionsOpen}
        onClose={() => setReactionsOpen(false)}
        reactions={m.reactions}
        myUid={context.myUid}
        resolveName={(uid) => context.reactorNames?.[uid] ?? null}
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
type ReceiptTone = 'green' | 'ink' | 'white';

function ReceiptIndicator({ message, isGroup, memberCount, tone = 'green' }: { message: Message; isGroup: boolean; memberCount?: number; tone?: ReceiptTone }) {
  const delivered = message.deliveredCount ?? 0;
  const read      = message.readCount ?? 0;
  // green → Telegram-style on the light-green sent bubble; ink → on the gray
  // media card; white → inside the translucent pill over the wallpaper.
  const fg = tone === 'green' ? TG_GREEN : tone === 'ink' ? colors.ink500 : 'rgba(255,255,255,.95)';
  // Read vs delivered: read keeps the strong accent, delivered drops to a
  // muted tint of the same tone (both bubbles are light now, so color — not
  // glyph count — still carries the distinction at a glance).
  const fgMuted = tone === 'green' ? '#9CC78F' : tone === 'ink' ? colors.ink400 : 'rgba(255,255,255,.6)';

  if (isGroup) {
    if (memberCount && memberCount < SMALL_GROUP_MAX) {
      return (
        <View style={s.receiptRow}>
          <Ionicons name="eye-outline" size={12} color={fg} />
          <Text style={[s.foot, { color: fg }]}>Seen by {read}</Text>
        </View>
      );
    }
    return (
      <View style={s.receiptRow}>
        <Ionicons name="checkmark-done" size={13} color={fg} />
        <Text style={[s.foot, { color: fg }]}>{delivered}</Text>
        <Ionicons name="eye-outline" size={12} color={fg} />
        <Text style={[s.foot, { color: fg }]}>{read}</Text>
      </View>
    );
  }
  if (read > 0)      return <Text style={[s.tick, { color: fg }]}>✓✓</Text>;
  if (delivered > 0) return <Text style={[s.tick, { color: fgMuted }]}>✓✓</Text>;
  return <Text style={[s.tick, { color: fgMuted }]}>✓</Text>;
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
  // Telegram light theme: sent = soft green with dark text, received = white;
  // bubble tails sit at the BOTTOM corner nearest the sender.
  sent:           { backgroundColor: '#EFFDDE', borderBottomRightRadius: 5 },
  recv:           { backgroundColor: '#fff', borderBottomLeftRadius: 5 },
  // Image/video card: light-gray fill + thin border, tight padding so the
  // frame reads as a slim mat around the media.
  bubbleMedia:    { backgroundColor: colors.ink100, borderWidth: 1, borderColor: colors.ink200, paddingHorizontal: 4, paddingVertical: 4 },
  // Emoji message: no bubble chrome at all — the 3D emoji sits on the wallpaper
  // and its time/ticks live in a translucent pill (Telegram sticker style).
  bubbleEmoji:    { backgroundColor: 'transparent', paddingHorizontal: 0, paddingVertical: 0, shadowOpacity: 0, elevation: 0 },
  bubbleFooterEmoji: { alignSelf: 'flex-end', backgroundColor: 'rgba(0,0,0,0.30)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginTop: 2 },
  bubbleRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  emoji3dWrap:    { alignItems: 'center', justifyContent: 'center', paddingVertical: 4, paddingHorizontal: 8 },
  bubbleText:     { fontSize: 16, color: colors.ink, lineHeight: 22, flexShrink: 1 },
  deletedText:    { fontStyle: 'italic', color: colors.ink500 },
  deletedTextMine:{ fontStyle: 'italic', color: colors.ink500 },
  meta:           { fontSize: 11, color: colors.ink500, marginBottom: 4, fontWeight: '600' },
  replyPreview:   { borderLeftWidth: 3, borderLeftColor: colors.primaryDark, paddingLeft: 8, marginBottom: 6, backgroundColor: 'rgba(0,0,0,.04)', borderRadius: 6, padding: 6 },
  // On the green sent bubble the reply accent goes green (Telegram-style).
  replyPreviewMine:{ backgroundColor: 'rgba(95,168,78,0.12)', borderLeftColor: TG_GREEN },
  replyName:      { fontSize: 11, fontWeight: '700', color: colors.primaryDark },
  replyNameMine:  { color: TG_GREEN_DARK },
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
  if (prev.onAvatarPress !== next.onAvatarPress) return false;
  if (prev.onMentionPress !== next.onMentionPress) return false;
  if (prev.onOpenContact !== next.onOpenContact) return false;
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
    if ((a as any).mentions  !== (b as any).mentions)  return false;
    if ((a as any).forwardedFrom !== (b as any).forwardedFrom) return false;
    if (a.poll    !== b.poll)    return false; // ref compare (live votes)
    if (a.sticker !== b.sticker) return false;
    if (a.location !== b.location || a.contact !== b.contact) return false;
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

