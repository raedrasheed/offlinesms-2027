// Pure helpers for push notifications (Phase 27). No Firestore / FCM here so
// the title/body building, recipient filtering, and token-cleanup decisions are
// unit-testable in isolation.

export type ChatType = 'direct' | 'group';

export interface MsgLike {
  type?: string;          // text | image | voice | ...
  text?: string;
}

export interface NotifSettings {
  enabled?: boolean;
  directMessages?: boolean;
  groupMessages?: boolean;
  reactions?: boolean;
  sound?: boolean;
  vibration?: boolean;
  showPreview?: boolean;
}

const PREVIEW_MAX = 120;

/** Human-readable, content-light preview of a message. */
export function messagePreview(msg: MsgLike): string {
  if (msg.type === 'image') return '📷 Photo';
  if (msg.type === 'voice') return '🎤 Voice message';
  if ((msg.type ?? 'text') === 'text' && typeof msg.text === 'string') {
    const t = msg.text.replace(/\s+/g, ' ').trim();
    if (!t) return 'Message';
    return t.length > PREVIEW_MAX ? t.slice(0, PREVIEW_MAX - 1) + '…' : t;
  }
  return 'Message';
}

export interface BuiltNotification { title: string; body: string }

/**
 * WhatsApp-style title/body. Respects `showPreview`:
 *   showPreview = false → generic body, no message content.
 *   direct  → title = sender,  body = preview
 *   group   → title = group,   body = "Sender: preview"
 */
export function buildNotification(args: {
  chatType: ChatType;
  groupName?: string | null;
  senderName?: string | null;
  msg: MsgLike;
  showPreview: boolean;
}): BuiltNotification {
  const sender = (args.senderName ?? 'Someone').trim() || 'Someone';

  if (!args.showPreview) {
    return args.chatType === 'group'
      ? { title: 'New group message', body: 'Open OfflineSMS to read it' }
      : { title: 'New message',       body: 'Open OfflineSMS to read it' };
  }

  const preview = messagePreview(args.msg);
  if (args.chatType === 'group') {
    return { title: (args.groupName ?? 'Group').trim() || 'Group', body: `${sender}: ${preview}` };
  }
  return { title: sender, body: preview };
}

/** Per-recipient decision: should we notify this person at all, and loudly? */
export interface RecipientCtx {
  uid: string;
  muted?: boolean;          // userState.muted
  settings?: NotifSettings; // users/{uid}/notificationSettings
}

export interface NotifyDecision {
  notify: boolean;          // send anything at all
  silent: boolean;          // data-only / no sound+vibration (muted or pref off)
  reason?: 'sender' | 'disabled' | 'type-off';
}

export function decideForRecipient(
  recipient: RecipientCtx,
  chatType: ChatType,
  senderUid: string,
): NotifyDecision {
  if (recipient.uid === senderUid) return { notify: false, silent: true, reason: 'sender' };

  const s = recipient.settings ?? {};
  // Default-on: a recipient with no settings doc still gets notifications.
  const enabled = s.enabled !== false;
  if (!enabled) return { notify: false, silent: true, reason: 'disabled' };

  const typeOn = chatType === 'group' ? s.groupMessages !== false : s.directMessages !== false;
  if (!typeOn) return { notify: false, silent: true, reason: 'type-off' };

  // Muted chat, or sound/vibration disabled → deliver silently.
  const silent = !!recipient.muted || s.sound === false;
  return { notify: true, silent };
}

/** Per-recipient decision for a REACTION notification (gated by the separate
 *  `reactions` setting). Reaction bodies never contain message text, so
 *  showPreview doesn't apply here. */
export function decideReactionForRecipient(
  recipient: RecipientCtx,
  authorUid: string,
  actorUid: string,
): NotifyDecision {
  if (authorUid === actorUid) return { notify: false, silent: true, reason: 'sender' };
  const s = recipient.settings ?? {};
  if (s.enabled === false) return { notify: false, silent: true, reason: 'disabled' };
  if (s.reactions === false) return { notify: false, silent: true, reason: 'type-off' };
  const silent = !!recipient.muted || s.sound === false;
  return { notify: true, silent };
}

/** Title/body for a reaction notification. The emoji + who reacted are shown
 *  (not the message text), so this is independent of showPreview. */
export function buildReactionNotification(args: {
  chatType: ChatType;
  groupName?: string | null;
  actorName?: string | null;
  emoji: string;
}): BuiltNotification {
  const actor = (args.actorName ?? 'Someone').trim() || 'Someone';
  if (args.chatType === 'group') {
    return { title: (args.groupName ?? 'Group').trim() || 'Group', body: `${actor} reacted ${args.emoji} to your message` };
  }
  return { title: actor, body: `Reacted ${args.emoji} to your message` };
}

/** FCM messaging error codes that mean a token is dead and should be removed. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

export function isDeadTokenError(code: string | undefined): boolean {
  return !!code && DEAD_TOKEN_CODES.has(code);
}

/** Stable collapse/thread id so many messages in one chat fold together. */
export function collapseKey(conversationId: string): string {
  return `convo_${conversationId}`;
}
