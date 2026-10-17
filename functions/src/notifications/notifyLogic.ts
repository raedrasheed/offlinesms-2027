// Pure helpers for push notifications (Phase 27). No Firestore / FCM here so
// the title/body building, recipient filtering, and token-cleanup decisions are
// unit-testable in isolation.

export type ChatType = 'direct' | 'group';

/** Recipient UI language (users/{uid}.preferredLanguage). */
export type NotifLang = 'en' | 'ar';

/** Normalise a stored preferredLanguage to a supported push language. */
export function notifLang(value: unknown): NotifLang {
  return value === 'ar' ? 'ar' : 'en';
}

const STRINGS: Record<NotifLang, {
  someone: string; group: string; photo: string; voice: string; sticker: string; message: string;
  newMessage: string; newGroupMessage: string; openToRead: string;
  file: string; video: string; audio: string; location: string; contact: string;
  reactedDirect: (emoji: string) => string;
  reactedGroup: (actor: string, emoji: string) => string;
}> = {
  en: {
    someone: 'Someone',
    group: 'Group',
    photo: '📷 Photo',
    file:'📎 File',video:'🎬 Video',audio:'🎵 Audio',location:'📍 Location',contact:'👤 Contact',
    voice: '🎤 Voice message',
    sticker: 'Sticker',
    message: 'Message',
    newMessage: 'New message',
    newGroupMessage: 'New group message',
    openToRead: 'Open OfflineSMS to read it',
    reactedDirect: (e) => `Reacted ${e} to your message`,
    reactedGroup: (a, e) => `${a} reacted ${e} to your message`,
  },
  ar: {
    someone: 'شخص ما',
    group: 'مجموعة',
    photo: '📷 صورة',
    file:'📎 ملف',video:'🎬 فيديو',audio:'🎵 ملف صوتي',location:'📍 موقع',contact:'👤 جهة اتصال',
    voice: '🎤 رسالة صوتية',
    sticker: 'ملصق',
    message: 'رسالة',
    newMessage: 'رسالة جديدة',
    newGroupMessage: 'رسالة جديدة في مجموعة',
    openToRead: 'افتح OfflineSMS لقراءتها',
    reactedDirect: (e) => `تفاعل بـ ${e} مع رسالتك`,
    reactedGroup: (a, e) => `${a} تفاعل بـ ${e} مع رسالتك`,
  },
};

/** Translated generic sender label used when a person has no public name. */
export function someoneLabel(lang: NotifLang = 'en'): string {
  return STRINGS[lang].someone;
}

export interface MsgLike {
  media?: {presentation?: string};
  type?: string;          // text | image | voice | sticker | poll | ...
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
export function messagePreview(msg: MsgLike, lang: NotifLang = 'en'): string {
  const L = STRINGS[lang];
  if (msg.type === 'file' || msg.type === 'video' || msg.type === 'audio' || msg.type === 'location' || msg.type === 'contact') return L[msg.type];
  if (msg.type === 'image') return msg.media?.presentation === 'sticker' ? L.sticker : L.photo;
  if (msg.type === 'voice') return L.voice;
  if (msg.type === 'sticker') return `${typeof msg.text === 'string' && msg.text ? msg.text + ' ' : ''}${L.sticker}`;
  if (((msg.type ?? 'text') === 'text' || msg.type === 'poll') && typeof msg.text === 'string') {
    const t = msg.text.replace(/\s+/g, ' ').trim();
    if (!t) return L.message;
    return t.length > PREVIEW_MAX ? t.slice(0, PREVIEW_MAX - 1) + '…' : t;
  }
  return L.message;
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
  /** Recipient language; defaults to English. */
  lang?: NotifLang;
}): BuiltNotification {
  const L = STRINGS[args.lang ?? 'en'];
  const sender = (args.senderName ?? '').trim() || L.someone;

  if (!args.showPreview) {
    return args.chatType === 'group'
      ? { title: L.newGroupMessage, body: L.openToRead }
      : { title: L.newMessage,      body: L.openToRead };
  }

  const preview = messagePreview(args.msg, args.lang ?? 'en');
  if (args.chatType === 'group') {
    return { title: (args.groupName ?? '').trim() || L.group, body: `${sender}: ${preview}` };
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
  /** Recipient language; defaults to English. */
  lang?: NotifLang;
}): BuiltNotification {
  const L = STRINGS[args.lang ?? 'en'];
  const actor = (args.actorName ?? '').trim() || L.someone;
  if (args.chatType === 'group') {
    return { title: (args.groupName ?? '').trim() || L.group, body: L.reactedGroup(actor, args.emoji) };
  }
  return { title: actor, body: L.reactedDirect(args.emoji) };
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
