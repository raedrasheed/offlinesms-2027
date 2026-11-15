import { loadFirebaseClient } from './firebase-bootstrap.js';
import { createSignInView } from './web-sign-in.js';
import { createLiveFeeds } from './live-feeds.js';
import { createChatTools } from './chat-tools.js';
import { createReactionDetails } from './reaction-details.js';
import { createGroupInviteView } from './group-invite.js';
import { createMessageInfo } from './message-info.js';
import { messageReceiptTotals } from './message-receipts.js';
import { createGroupInfo } from './group-info.js';
import { createChatMedia } from './chat-media.js';
import { bundledSticker, createChatMediaSource } from './chat-media-source.js';
import { downloadChatMedia } from './chat-media-download.js';
import { createChatAttachments } from './chat-attachments.js';
import { openStructuredAttachment } from './chat-attachments-structured.js';
import { renderRichMessage } from './chat-rich-message.js';
import { createChatReceipts } from './chat-receipts.js';
import { createMentionComposer } from './chat-mentions.js';
import { createMessageLink, messageLinks } from './message-links.js';
import { createProfileSettings } from './profile-settings.js';
import { createSettingsLayout, settingsLabels } from './settings-layout.js';
import { createSettingsAccountSecurity } from './settings-account-security.js';
import { createSettingsDevicesPoints } from './settings-devices-points.js';
import { createSettingsFriendsWallpaper, readBrowserWallpaper } from './settings-friends-wallpaper.js';
import { createSettingsSupport } from './settings-support.js';
import { createSettingsPreferences } from './settings-preferences.js';
import { DEFAULT_NOTIFICATION_PREFERENCES } from './settings-preferences-client.js';
import { showConnectedBrowserNotification } from './settings-browser-permissions.js';
import { version as webVersion } from './package.json';
import { isExternalId, looksLikeUid } from '../mobile/src/lib/displayNames.pure.ts';
import { renderMentionSegments } from '../mobile/src/lib/mentions.ts';

const words = {
  profilePhoto: ['صورة الملف الشخصي', 'Profile photo'],
  profilePhotoInvalid: ['اختر صورة JPEG أو PNG أو WebP أصغر من 5 ميغابايت.', 'Choose a JPEG, PNG, or WebP image smaller than 5 MB.'],
  profilePhotoFailed: ['تعذّر حفظ صورة الملف الشخصي.', 'Could not save the profile photo.'],
  profilePhotoSaved: ['تم تحديث صورة الملف الشخصي.', 'Profile photo updated.'],
  newMessageNotification: ['رسالة جديدة', 'New message'],
  navigation: ['التنقل', 'Navigation'], chats: ['المحادثات', 'Chats'], status: ['الحالات', 'Status'],
  clips: ['المقاطع', 'Clips'], settings: ['الإعدادات', 'Settings'], conversations: ['المحادثات', 'Conversations'],
  filters: ['فلترة المحادثات', 'Filter conversations'], all: ['الكل', 'All'], unread: ['غير مقروءة', 'Unread'],
  favorites: ['المفضلة', 'Favorites'], groups: ['المجموعات', 'Groups'], search: ['ابحث في المحادثات', 'Search conversations'],
  loading: ['جارٍ التحميل…', 'Loading…'], none: ['لا توجد محادثات مطابقة.', 'No matching conversations.'],
  noChats: ['لا توجد محادثات بعد.', 'You have no conversations yet.'], choose: ['اختر محادثة لعرض الرسائل.', 'Select a conversation to see your messages.'],
  loadFailed: ['تعذّر تحميل البيانات. تحقّق من الاتصال وأعد المحاولة.', 'Could not load the data. Check your connection and try again.'],
  retry: ['إعادة المحاولة', 'Retry'], back: ['العودة إلى المحادثات', 'Back to chats'], details: ['تفاصيل المحادثة', 'Conversation details'],
  findMessages: ['البحث في الرسائل المعروضة', 'Search loaded messages'], noMessages: ['لا توجد رسائل مطابقة.', 'No matching messages.'],
  wallpaper: ['خلفية المحادثة', 'Chat wallpaper'], defaultWallpaper: ['خلفية التطبيق', 'App wallpaper'],
  plainWallpaper: ['خلفية سادة', 'Plain background'], history: ['سجل الرسائل', 'Message history'],
  message: ['الرسالة', 'Message'], typeMessage: ['اكتب رسالة', 'Type a message'], send: ['إرسال', 'Send'],
  latest: ['الانتقال إلى أحدث الرسائل', 'Scroll to latest messages'], close: ['إغلاق', 'Close'],
  composerOptions: ['خيارات الرسالة', 'Message options'], actions: ['إجراءات الرسالة', 'Message actions'],
  attach: ['إرفاق', 'Attach'],
  quickReaction: ['تفاعل سريع', 'Quick reaction'], direct: ['محادثة فردية', 'Direct conversation'], group: ['مجموعة', 'Group'],
  reactions: ['التفاعلات', 'Reactions'], viewReactions: ['عرض المتفاعلين', 'View reactions'],
  members: ['أعضاء', 'members'], peer: ['مستخدم OfflineSMS', 'OfflineSMS user'], you: ['أنت', 'You'],
  replyTo: ['الرد على', 'Replying to'], cancelReply: ['إلغاء الرد', 'Cancel reply'], forwarded: ['معاد توجيهها', 'Forwarded'],
  edited: ['تم التعديل', 'Edited'], pinned: ['رسالة مثبّتة', 'Pinned message'], unpin: ['إلغاء تثبيت الرسالة', 'Unpin message'],
  removed: ['حُذفت هذه الرسالة.', 'This message was deleted.'], sent: ['أُرسلت', 'Sent'],
  seen: ['شوهدت', 'Seen'],
  delivered: ['وصلت', 'Delivered'], read: ['قُرئت', 'Read'], sendRestricted: ['الإرسال مقيّد في هذه المحادثة.', 'Sending is restricted in this conversation.'],
  sendError: ['تعذّر الإرسال. بقيت رسالتك في حقل الكتابة.', 'Could not send. Your message is still in the composer.'],
  actionFailed: ['تعذّر تنفيذ الإجراء. حاول مرة أخرى.', 'Could not complete the action. Try again.'],
  mediaUnavailable: ['الوسائط غير متاحة للعرض.', 'This media is unavailable.'],
  mediaLoad: ['عرض المرفق', 'Open attachment'], image: ['صورة', 'Image'], video: ['فيديو', 'Video'],
  voice: ['رسالة صوتية', 'Voice message'], audio: ['تسجيل صوتي', 'Audio'], file: ['ملف', 'File'],
  poll: ['استطلاع رأي', 'Poll'], sticker: ['ملصق', 'Sticker'], location: ['موقع', 'Location'], contact: ['جهة اتصال', 'Contact'], clip: ['مقطع', 'Clip'],
  newChat: ['محادثة جديدة', 'New chat'], username: ['اسم المستخدم', 'Username'], find: ['بحث', 'Find'],
  noUser: ['لم يُعثر على اسم المستخدم.', 'No matching username was found.'], openChat: ['فتح المحادثة', 'Open conversation'],
  language: ['اللغة', 'Language'], appearance: ['المظهر', 'Appearance'], system: ['النظام', 'System'], light: ['فاتح', 'Light'],
  dark: ['داكن', 'Dark'], signOut: ['تسجيل الخروج', 'Sign out'], time: ['تنسيق الوقت', 'Time format'],
  hour12: ['١٢ ساعة', '12-hour'], hour24: ['٢٤ ساعة', '24-hour'], account: ['الحساب', 'Account'],
  signOutFailed: ['تعذّر تسجيل الخروج. حاول مرة أخرى.', 'Could not sign out. Try again.'],
  privacy: ['سياسة الخصوصية', 'Privacy policy'], terms: ['شروط الاستخدام', 'Terms of service'],
  recent: ['المحادثات الأخيرة', 'Recent conversations'],
  groupInvite: ['دعوة المجموعة', 'Group invitation'],
  useDefaultWallpaper: ['استخدام الإعداد العام', 'Use global default'],
};

const byId = (id) => document.getElementById(id);
const workspace = byId('workspace');
const main = byId('app-main');
const list = byId('threads');
const search = byId('search');
const messageInput = byId('message');
const scroll = byId('chat-scroll');
const flow = byId('message-flow');
const composer = byId('composer');
const composerArea = composer.closest('footer');
const feedback = byId('send-feedback');
const latest = byId('latest');
const featurePanel = byId('feature-panel');
const dialog = byId('dialog');
const messageInfoPanel = byId('message-info');
const groupInfoPanel = byId('group-info');
const inviteShortcut = byId('group-invite-shortcut');
const mobile = window.matchMedia('(max-width: 670px)');
const darkMode = window.matchMedia('(prefers-color-scheme: dark)');
const navigation = [...document.querySelectorAll('.nav-tab')];
const filters = [...document.querySelectorAll('[data-filter]')];

function preference(key, choices, fallback) {
  try {
    const saved = localStorage.getItem('offlinesms-web-' + key);
    return choices.includes(saved) ? saved : fallback;
  } catch { return fallback; }
}

function savePreference(key, value) {
  try { localStorage.setItem('offlinesms-web-' + key, value); } catch { /* Browser storage can be disabled. */ }
}

let language = preference('language', ['ar', 'en'], 'ar');
let theme = preference('theme', ['system', 'dark', 'light'], 'dark');
let clock = preference('clock', ['system', '12h', '24h'], 'system');
const wallpaperFallback = preference('wallpaper', ['default', 'plain'], 'default');
let wallpaper = readBrowserWallpaper(undefined, wallpaperFallback);
let client;
let user;
let session = 0;
let threadGeneration = 0;
let section = 'chats';
let filter = 'all';
let conversations = [];
let listState = 'loading';
let activeId;
let currentThread;
let groupInfo;
let threadError = false;
let stopList;
let stopThread;
let stopAccount;
let accountWatch = 0;
let unsubscribeAuth;
let pendingRead;
let announcementTimer;
let renderedThread;
let attachments;
let mentionRoster;
let profileSettings;
let settingsPage;
let accountDeletionUid;
let stopNotificationPreferences;
let notificationPreferences = DEFAULT_NOTIFICATION_PREFERENCES;
let lastPollVoteSeq = 0;
const profiles = new Map();
const userStates = new Map();
const stopStates = new Map();
const localMessageCounts = new Map();
const connectedNotifications = new Map();
const pendingConversationAlerts = new Map();
const drafts = new Map();
const replies = new Map();
const sends = new Map();
const attachmentSends = new Map();
const mediaRenderKeys = new WeakMap();
const richRenderKeys = new WeakMap();
const chatReceipts = createChatReceipts({ viewport: scroll, flow, canRead: canReadMessages,
  send: (receipt) => call('markReceipt', receipt) });
const mentionComposer = createMentionComposer({ input: messageInput, list: byId('mention-suggestions'),
  language: () => language, requestMembers: requestMentionMembers, onChange: updateDraft });

const t = (key) => words[key]?.[language === 'ar' ? 0 : 1] ?? words.message[language === 'ar' ? 0 : 1];
const numeral = (value) => new Intl.NumberFormat(language).format(value);
const inviteCodePattern = /^[ABCDEFGHJKMNPQRSTVWXYZ0123456789]{8,40}$/;

function inviteCodeFromHash(hash) {
  if (!hash.startsWith('#join=')) return undefined;
  const code = hash.slice('#join='.length);
  return inviteCodePattern.test(code) ? code : null;
}

function inviteCodeFromLocation() {
  return inviteCodeFromHash(location.hash);
}

function sharedInviteCode(value) {
  if (value.includes('\\')) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.origin === 'https://web.offlinesms.com' && url.pathname === '/') return inviteCodeFromHash(url.hash);
    if (!['https://links.offlinesms.com', 'https://offlinesms.com'].includes(url.origin)) return null;
    const code = url.pathname.match(/^\/join\/([A-Z0-9]+)\/?$/)?.[1];
    return code && inviteCodePattern.test(code) ? code : null;
  } catch { return null; }
}

const messageLinkActions = {
  inviteCode: sharedInviteCode,
  openInvite(code) {
    if (code === inviteCodeFromLocation()) showGroupInvite();
    else location.hash = `join=${code}`;
  },
};

function showGroupInvite() {
  const code = inviteCodeFromLocation();
  inviteShortcut.hidden = code === undefined;
  if (!user) { signIn.render(); return; }
  if (code !== undefined) inviteView.open(code);
  else if (dialog.querySelector('.group-invite')) closeDialog();
}

function clearInvite(code) {
  if (code !== inviteCodeFromLocation()) return;
  const url = new URL(location.href);
  url.hash = '';
  history.replaceState(history.state, '', url);
  inviteShortcut.hidden = true;
}

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(text, run, className = 'dialog-action') {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', run);
  return node;
}

function iconButton(path, title, run, className) {
  const node = button('', run, className);
  node.setAttribute('aria-label', title);
  node.append(outlineIcon(path));
  return node;
}

function outlineIcon(path) {
  const ns = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(ns, 'svg');
  const line = document.createElementNS(ns, 'path');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  line.setAttribute('d', path);
  icon.append(line);
  return icon;
}

function applyTheme() {
  const resolved = theme === 'system' ? (darkMode.matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]').content = resolved === 'dark' ? '#191a1a' : '#fff';
}

function formatTime(value) {
  const seconds = value?.seconds ?? value?._seconds;
  const date = value?.toDate?.() ?? new Date(Number.isFinite(seconds) ? seconds * 1000 : value ?? NaN);
  if (!Number.isFinite(date.getTime())) return '';
  const hourCycle = clock === '24h' ? 'h23' : clock === '12h' ? 'h12' : undefined;
  return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', hourCycle }).format(date);
}

function setLanguage(next) {
  if (!['ar', 'en'].includes(next)) return;
  language = next;
  savePreference('language', next);
  document.documentElement.lang = next;
  document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-copy]').forEach((node) => { node.textContent = t(node.dataset.copy); });
  document.querySelectorAll('[data-label]').forEach((node) => { node.setAttribute('aria-label', t(node.dataset.label)); });
  document.querySelectorAll('[data-placeholder]').forEach((node) => { node.placeholder = t(node.dataset.placeholder); });
  navigation.forEach((node) => { node.title = t(node.dataset.section); });
  if (!user) signIn.render();
  else if (section === 'chats') { renderList(); renderThread(); }
  else renderSection();
}

function disposeAttachments() {
  attachments?.close();
  attachments = undefined;
}

function showDialog(title, content, attachmentDialog = false) {
  if (!attachmentDialog) disposeAttachments();
  viewingMedia = undefined;
  viewingReactions = undefined;
  byId('dialog-title').textContent = title;
  byId('dialog-content').replaceChildren(content);
  if (!dialog.open) dialog.showModal();
  else content.querySelector('button, input, select, textarea')?.focus();
  chatReceipts.refreshVisibility();
}

function closeDialog() {
  disposeAttachments();
  viewingMedia = undefined;
  viewingReactions = undefined;
  if (dialog.open) dialog.close();
  byId('dialog-content').replaceChildren();
  byId('dialog-title').textContent = '';
  chatReceipts.refreshVisibility();
}

function announce(text) {
  const status = byId('announcement');
  clearTimeout(announcementTimer);
  status.textContent = text;
  if (text) announcementTimer = window.setTimeout(() => { status.textContent = ''; }, 3500);
}

function peerId(item) {
  return item?.type === 'direct' ? item.participantUids?.find((uid) => uid !== user?.uid) : undefined;
}

async function requestMentionMembers(conversationId) {
  const uid = user?.uid;
  const conversation = currentThread?.conversation;
  if (!uid || conversationId !== conversation?.id || conversation.type !== 'group') return [];
  const ids = conversation.participantUids.filter(id => typeof id === 'string' && id !== uid && !isExternalId(id));
  const key = JSON.stringify([conversationId, ids]);
  if (mentionRoster?.key !== key || mentionRoster.expiresAt < Date.now()) {
    const request = { key, expiresAt: Date.now() + 60_000, profiles: client.getGroupMemberProfiles(uid, ids) };
    mentionRoster = request;
    request.profiles.catch(() => { if (mentionRoster === request) mentionRoster = undefined; });
  }
  const generation = session;
  const rows = await mentionRoster.profiles;
  if (generation !== session || activeId !== conversationId || !currentThread) return [];
  const participants = new Set(currentThread.conversation.participantUids);
  const compare = new Intl.Collator(language, { numeric: true, sensitivity: 'base' }).compare;
  return rows.flatMap((profile) => {
    if (profile?.status !== 'active' || !participants.has(profile.uid)) return [];
    const username = profile.username.trim().replace(/^@+/, '');
    const name = profile.displayName.trim().replace(/^@+/, '');
    const displayName = (looksLikeUid(name, profile.uid) ? username : name || username).slice(0, 80).trimEnd();
    return displayName ? [{ uid: profile.uid, displayName, username, photoURL: safeMediaUrl(profile.photoURL) }] : [];
  }).sort((a, b) => compare(a.displayName, b.displayName) || compare(a.username, b.username));
}

function threadName(item) {
  const peer = profiles.get(peerId(item));
  return item?.type === 'direct'
    ? (peer?.displayName || peer?.username || t('peer'))
    : (item?.name || t('group'));
}

function safeMediaUrl(value) {
  try {
    const url = new URL(value);
    const validHosts = ['firebasestorage.googleapis.com', 'storage.googleapis.com', 'lh3.googleusercontent.com'];
    return url.protocol === 'https:' && validHosts.includes(url.hostname) ? url.href : '';
  } catch { return ''; }
}

function avatar(name, url, group = false) {
  const node = el('span', group ? 'avatar avatar-group' : 'avatar');
  node.setAttribute('aria-hidden', 'true');
  const fallback = name.trim().split(/\s+/).slice(0, 2).map((part) => [...part][0]).join('').toUpperCase();
  const src = safeMediaUrl(url);
  if (!src) node.textContent = fallback;
  else {
    const image = el('img');
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.src = src;
    image.addEventListener('error', () => { node.textContent = fallback; }, { once: true });
    node.append(image);
  }
  return node;
}

function messageText(item) {
  if (item.deletedForEveryone) return t('removed');
  return item.text || item.caption || t(item.type);
}

function senderName(item) {
  const uid = item.senderUid ?? item.senderId;
  return uid === user?.uid ? t('you') : (item.senderDisplayName || profiles.get(uid)?.displayName || profiles.get(uid)?.username || t('peer'));
}

function canSeeThread(item) {
  return !userStates.get(item.id)?.archived;
}

function matches(item, key) {
  const state = userStates.get(item.id);
  return canSeeThread(item) && (key === 'all' ||
    (key === 'groups' && item.type !== 'direct') ||
    (key === 'unread' && state?.unreadCount > 0) ||
    (key === 'favorites' && state?.favorite));
}

function updateBadges() {
  const count = (key) => conversations.reduce((sum, item) => sum + (matches(item, key) ? Math.max(0, userStates.get(item.id)?.unreadCount || 0) : 0), 0);
  for (const item of filters) {
    const amount = count(item.dataset.filter);
    const badge = item.querySelector('.filter-unread');
    badge.hidden = amount <= 0;
    badge.textContent = numeral(amount);
    item.setAttribute('aria-pressed', String(item.dataset.filter === filter));
  }
  const unread = count('all');
  const badge = byId('nav-unread');
  badge.hidden = unread <= 0;
  badge.textContent = numeral(unread);
  badge.closest('button').setAttribute('aria-label', unread ? `${t('chats')} · ${numeral(unread)} ${t('unread')}` : t('chats'));
}

function listNotice(key, retry) {
  const entry = el('li', 'no-results', t(key));
  if (retry) entry.append(button(t('retry'), retry, 'feature-button live-retry'));
  list.replaceChildren(entry);
}

function renderList() {
  updateBadges();
  if (listState === 'loading') { listNotice('loading'); return; }
  if (listState === 'error') { listNotice('loadFailed', subscribeList); return; }
  const query = search.value.trim().toLocaleLowerCase(language);
  const visible = conversations.filter((item) => matches(item, filter) && (!query || threadName(item).toLocaleLowerCase(language).includes(query)));
  visible.sort((a, b) => Number(Boolean(userStates.get(b.id)?.pinned)) - Number(Boolean(userStates.get(a.id)?.pinned)));
  if (!visible.length) { listNotice(!query && filter === 'all' ? 'noChats' : 'none'); return; }
  const focused = document.activeElement?.closest('[data-thread]')?.dataset.thread;
  const buttons = new Map();
  list.replaceChildren(...visible.map((item) => {
    const state = userStates.get(item.id);
    const name = threadName(item);
    const unread = state?.unreadCount || 0;
    const row = button('', () => openThread(item.id), 'thread');
    row.dataset.thread = item.id;
    row.setAttribute('aria-label', unread ? `${name} · ${numeral(unread)} ${t('unread')}` : name);
    if (activeId === item.id) row.setAttribute('aria-current', 'true');
    if (unread) row.classList.add('thread-unread');
    const peer = profiles.get(peerId(item));
    const text = el('span', 'thread-copy');
    text.append(el('span', 'thread-name', name), el('span', 'thread-preview', item.lastMessage?.preview || item.lastMessageText || ''));
    const meta = el('span', 'thread-meta');
    meta.append(el('span', 'thread-time', formatTime(item.lastMessage?.createdAt || item.lastMessageAt || item.updatedAt)));
    if (unread) meta.append(el('span', 'unread', numeral(unread)));
    row.append(avatar(name, peer?.photoURL || item.avatarUrl, item.type !== 'direct'), text, meta);
    const li = el('li');
    li.append(row);
    buttons.set(item.id, row);
    return li;
  }));
  buttons.get(focused)?.focus({ preventScroll: true });
}

function syncProfile(uid) {
  if (!uid || profiles.has(uid)) return;
  const generation = session;
  profiles.set(uid, null);
  client.getPublicProfile(uid).then((profile) => {
    if (generation !== session) return;
    profiles.set(uid, profile);
    if (section === 'chats') renderList();
    if (activeId && peerId(currentThread?.conversation) === uid) renderThreadHeader();
  }).catch(() => {
    if (generation === session) profiles.delete(uid);
  });
}

function alertConversation(item) {
  if (!pendingConversationAlerts.delete(item.id) || !user || userStates.get(item.id)?.muted) return;
  const group = item.type === 'group';
  if (!notificationPreferences.enabled || (group ? !notificationPreferences.groupMessages : !notificationPreferences.directMessages)) return;
  if (activeId === item.id && canReadMessages()) return;
  const title = threadName(item);
  const message = item.lastMessage;
  const preview = notificationPreferences.showPreview && message?.preview ? message.preview : t('newMessageNotification');
  if (!document.hidden && document.hasFocus()) {
    if (user.inAppNotifications !== false) announce(`${title} · ${preview}`);
    return;
  }
  const generation = session;
  connectedNotifications.get(item.id)?.close();
  const notice = showConnectedBrowserNotification({
    title, body: preview, tag: `offlinesms-chat-${item.id}`,
    sound: notificationPreferences.sound, vibration: notificationPreferences.vibration,
    onOpen() {
      if (generation !== session || !conversations.some(row => row.id === item.id)) return;
      navigate('chats');
      openThread(item.id);
    },
  });
  if (notice) {
    connectedNotifications.set(item.id, notice);
    notice.addEventListener?.('close', () => {
      if (connectedNotifications.get(item.id) === notice) connectedNotifications.delete(item.id);
    });
  }
}

function subscribeList() {
  stopList?.();
  listState = 'loading';
  renderList();
  const generation = session;
  const subscribedAt = Date.now();
  stopList = client.watchConversations(user.uid, (rows) => {
    if (generation !== session) return;
    const previous = new Map(conversations.map(item => [item.id, item.lastMessage?.messageId]));
    const initialized = listState === 'ready';
    listState = 'ready';
    conversations = rows;
    const ids = new Set(rows.map((item) => item.id));
    for (const [id, stop] of stopStates) {
      if (ids.has(id)) continue;
      stop();
      stopStates.delete(id);
      userStates.delete(id);
      pendingConversationAlerts.delete(id);
      connectedNotifications.get(id)?.close();
      connectedNotifications.delete(id);
      localMessageCounts.delete(id);
    }
    for (const item of rows) {
      const message = item.lastMessage;
      const freshConversation = !previous.has(item.id) && message?.createdAt?.toMillis?.() >= subscribedAt;
      if (initialized && message?.messageId && message.senderUid && message.senderUid !== user.uid
          && ((previous.has(item.id) && previous.get(item.id) !== message.messageId) || freshConversation)) {
        pendingConversationAlerts.set(item.id, item);
        if (userStates.has(item.id)) alertConversation(item);
      }
      syncProfile(peerId(item));
      if (stopStates.has(item.id)) continue;
      const stop = client.watchUserState(user.uid, item.id, (state) => {
        if (generation !== session) return;
        userStates.set(item.id, state);
        const pending = pendingConversationAlerts.get(item.id);
        if (pending) alertConversation(pending);
        if (section === 'chats') renderList();
      }, () => {});
      stopStates.set(item.id, stop);
    }
    renderList();
  }, () => {
    if (generation !== session) return;
    listState = 'error';
    conversations = [];
    for (const stop of stopStates.values()) stop();
    stopStates.clear();
    userStates.clear();
    pendingConversationAlerts.clear();
    renderList();
  });
}

function openThread(id, focus = true) {
  if (!user) return;
  chatReceipts.stop();
  if (viewingReactions || attachments) closeDialog();
  closeMedia();
  closeMessageInfo();
  closeGroupInfo();
  tools.dismiss();
  stopThread?.();
  activeId = id;
  applyWallpaper();
  currentThread = undefined;
  threadError = false;
  pendingRead = undefined;
  const generation = ++threadGeneration;
  workspace.dataset.mobileView = 'chat';
  messageInput.value = drafts.get(id) || '';
  renderList();
  renderThread();
  if (focus && mobile.matches) byId('chat-title').focus({ preventScroll: true });
  stopThread = client.watchThread(user.uid, id, (value) => {
    if (generation !== threadGeneration) return;
    const previous = currentThread;
    currentThread = value;
    localMessageCounts.set(id, value.messages.length);
    if (attachments && sendingRestricted()) closeDialog();
    if (viewingMedia && !isActiveMedia(viewingMedia)) closeDialog();
    if (viewingReactions) updateReactionDetails();
    if (groupInfo) {
      if (!value.role || value.conversation.type !== 'group') closeGroupInfo();
      else {
        if (['owner', 'admin'].includes(previous?.role) && !['owner', 'admin'].includes(value.role)) closeDialog();
        groupInfo.update();
      }
    }
    threadError = false;
    syncProfile(peerId(value.conversation));
    const atBottom = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 90;
    if (section === 'chats') renderThread(!previous || atBottom);
    trackReceivedMessages();
    if (section === 'chats') maybeMarkRead();
  }, () => {
    if (generation !== threadGeneration) return;
    chatReceipts.stop();
    currentThread = undefined;
    closeMedia();
    threadError = true;
    closeMessageInfo();
    closeGroupInfo();
    tools.dismiss();
    closeDialog();
    renderThread();
  });
}

function canReadMessages() {
  return Boolean(user && currentThread && messageInfoPanel.hidden && groupInfoPanel.hidden && !dialog.open
    && section === 'chats' && workspace.dataset.mobileView === 'chat' && !document.hidden && document.hasFocus());
}

function trackReceivedMessages() {
  if (!user || !currentThread) return;
  const confirmed = new Set(currentThread.serverMessageIds);
  const incoming = currentThread.messages.filter((message) => {
    const sender = message.senderUid ?? message.senderId;
    const upload = message.media?.uploadStatus;
    return confirmed.has(message.id) && sender && sender !== user.uid && !message.deletedForEveryone && !message.retentionDeleting
      && (!upload || upload === 'uploaded');
  });
  chatReceipts.update(activeId, user.uid, incoming.reverse().map(({ id }) => id));
}

function maybeMarkRead() {
  chatReceipts.refreshVisibility();
  if (!canReadMessages()) return;
  if (!currentThread.userState?.unreadCount) return;
  const incoming = currentThread.messages.findLast((message) => message.senderUid !== user.uid);
  if (!incoming || pendingRead === incoming.id) return;
  const generation = threadGeneration;
  pendingRead = incoming.id;
  client.markRead(activeId).catch(() => {
    if (generation === threadGeneration && pendingRead === incoming.id) pendingRead = undefined;
  });
}

let viewingMedia;
let viewingReactions;

function messageReactions(item) {
  if (!item?.reactions || item.deletedForEveryone || item.retentionDeleting) return [];
  return Object.entries(item.reactions).flatMap(([emoji, users]) => {
    const uids = Array.isArray(users) ? [...new Set(users.filter((uid) => typeof uid === 'string' && uid))] : [];
    return emoji && uids.length ? [{ emoji, uids }] : [];
  });
}

function updateReactionDetails() {
  const reactions = messageReactions(currentThread.messages.find((item) => item.id === viewingReactions.messageId));
  if (!reactions.length) { closeDialog(); return; }
  const key = JSON.stringify(reactions);
  if (key === viewingReactions.key) return;
  viewingReactions.key = key;
  viewingReactions.update(reactions);
}

function openReactionDetails(messageId, emoji, trigger) {
  if (!user || section !== 'chats' || !trigger.isConnected) return;
  const reactions = messageReactions(currentThread?.messages.find((item) => item.id === messageId));
  if (!reactions.length) return;
  const uid = user.uid;
  const generation = threadGeneration;
  const { view, update } = createReactionDetails({
    locale: language, reactions, initialEmoji: emoji, makeAvatar: avatar,
    isActive: () => user?.uid === uid && threadGeneration === generation && dialog.open && view.isConnected,
    async resolveProfile(reactorUid) {
      if (reactorUid === uid) return { name: t('you') };
      const profile = profiles.get(reactorUid) ?? await client.getPublicProfile(reactorUid).catch(() => null);
      const snapshot = generation === threadGeneration ? currentThread?.messages.findLast((item) =>
        (item.senderUid ?? item.senderId) === reactorUid && item.senderDisplayName) : undefined;
      const name = profile?.displayName?.trim() || profile?.username?.trim() || snapshot?.senderDisplayName?.trim();
      return name ? { name, photoURL: profile?.photoURL || snapshot?.senderPhotoURL } : null;
    },
  });
  tools.dismiss();
  showDialog(t('reactions'), view);
  viewingReactions = { messageId, key: JSON.stringify(reactions), update };
}

function mediaIdentity(item) {
  const { media, sticker } = item;
  return JSON.stringify([item.type, item.senderUid ?? item.senderId, media?.storagePath, media?.downloadURL,
    media?.uploadStatus, media?.presentation, media?.sizeBytes, media?.mimeType, sticker?.packId, sticker?.stickerId]);
}

function isActiveMedia(item) {
  if (!user || item.thread !== threadGeneration || item.conversationId !== activeId || section !== 'chats') return false;
  const message = currentThread?.messages.find((row) => row.id === item.id);
  return Boolean(message && !message.deletedForEveryone && !message.retentionDeleting && item.identity === mediaIdentity(message));
}

function closeMedia() {
  chatMedia.reset();
  mediaSource.clear();
  if (dialog.querySelector('.chat-media-viewer')) closeDialog();
}

const mediaSource = createChatMediaSource({ getClient: () => client, isActive: isActiveMedia });
const chatMedia = createChatMedia({
  t, locale: () => language, getMedia: mediaSource.getMedia, isActive: isActiveMedia, stickerSource: bundledSticker,
  getDownloadInfo: mediaSource.getDownloadInfo,
  showDialog: (title, content, item) => { showDialog(title, content); viewingMedia = item; },
  downloadMedia(item, data, { signal, isActive }) {
    return downloadChatMedia({ url: data.src, fileName: data.fileName, mimeType: data.contentType, expectedSize: data.sizeBytes,
      type: item.isSticker ? 'sticker' : item.type, signal, isActive,
      getUrl: data.path ? () => mediaSource.getDownloadUrl(item, data.path) : undefined,
      getBlob: data.path ? (maxBytes) => client.getMediaBlob(data.path, maxBytes) : undefined });
  },
});

function messageBody(item) {
  if (!chatMedia.handles(item)) return item.caption || item.text || t(item.type);
  if (chatMedia.isSticker(item)) return '';
  if (!item.media) return item.caption || item.text || '';
  const text = item.text?.trim();
  const label = { image: 'Photo', video: 'Video', file: 'File', audio: 'Audio', voice: 'Voice message' }[item.type];
  const placeholder = text === label || text === `${label}: ${item.media.fileName}`;
  return item.caption || (placeholder ? '' : item.text) || '';
}

function jumpTo(id) {
  const row = [...flow.children].find((node) => node.dataset.message === id);
  if (!row) { announce(t('noMessages')); return; }
  row.scrollIntoView({ block: 'center' });
  row.querySelector('.message-menu-toggle')?.focus({ preventScroll: true });
  row.classList.add('message-highlight');
  window.setTimeout(() => row.classList.remove('message-highlight'), 1800);
}

function renderMessageText(value, mentions) {
  const text = String(value);
  const body = el('p', 'message-text');
  body.dir = 'auto';
  const valid = Array.isArray(mentions) ? mentions.filter((mention) => (
    typeof mention?.userId === 'string' && typeof mention.displayName === 'string'
    && Number.isInteger(mention.startIndex) && Number.isInteger(mention.endIndex)
    && (mention.startIndex === 0 || /\s/u.test(text[mention.startIndex - 1] ?? ''))
    && text.slice(mention.startIndex, mention.endIndex) === `@${mention.displayName}`
  )) : [];
  for (const segment of renderMentionSegments(text, valid)) {
    if (segment.type === 'mention') {
      const name = el('bdi', 'message-mention', segment.text);
      body.append(name);
      continue;
    }
    let offset = 0;
    for (const link of messageLinks(segment.text)) {
      body.append(segment.text.slice(offset, link.start), createMessageLink(link, messageLinkActions));
      offset = link.end;
    }
    body.append(segment.text.slice(offset));
  }
  return body;
}

function canSendViaOfflineSms(item) {
  return Boolean(item && (item.senderUid ?? item.senderId) === user.uid
    && !item.deletedForEveryone && !item.retentionDeleting
    && ['text', 'location', 'contact'].includes(item.type)
    && !['sending', 'failed'].includes(item.status));
}

function groupReceiptCounters(item) {
  const { delivered, seen } = messageReceiptTotals(item);
  const counters = el('span', 'message-receipt-counts');
  counters.dir = 'ltr';
  for (const [status, label, value, icon] of [
    ['delivered', t('delivered'), delivered, 'm2 13 4 4L17 6m-8 10 2 2L23 6'],
    ['seen', t('seen'), seen, 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Zm13 0a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z'],
  ]) {
    const counter = el('span', 'message-receipt-count');
    const formatted = numeral(value);
    counter.dataset.status = status;
    counter.title = `${label} · ${formatted}`;
    counter.append(outlineIcon(icon), el('span', 'sr-only', `${label} `), formatted);
    counters.append(counter);
  }
  return counters;
}

function richMessage(item, existing) {
  if (!['location', 'contact', 'poll'].includes(item.type)) return null;
  const generation = threadGeneration;
  const conversationId = activeId;
  const uid = user.uid;
  const isActive = () => generation === threadGeneration && section === 'chats' && user?.uid === uid
    && currentThread?.messages.some((message) => message.id === item.id && !message.deletedForEveryone && !message.retentionDeleting);
  const conversation = currentThread.conversation;
  const canVote = conversation.status !== 'disabled' && (conversation.type !== 'group' || Boolean(currentThread.role));
  const key = JSON.stringify([generation, language, item.type, item[item.type], item.senderUid ?? item.senderId, canVote]);
  if (richRenderKeys.get(existing) === key) return existing;
  const card = renderRichMessage(item, {
    locale: language, uid, isActive,
    canVote,
    async votePoll(optionIds, afterSeq = 0) {
      if (!isActive()) throw new Error('message-unavailable');
      lastPollVoteSeq = Math.max(Date.now(), lastPollVoteSeq + 1, afterSeq + 1);
      return call('votePoll', { conversationId, messageId: item.id, optionIds, seq: lastPollVoteSeq, voterUid: uid });
    },
    getBallot: () => isActive() ? client.getPollBallot(conversationId, item.id) : Promise.resolve(null),
    closePoll: () => isActive() ? call('closePoll', { conversationId, messageId: item.id }) : Promise.reject(new Error('message-unavailable')),
  });
  if (card) richRenderKeys.set(card, key);
  return card;
}

function renderMessage(item, existingRow) {
  const own = (item.senderUid ?? item.senderId) === user.uid;
  const group = currentThread.conversation.type !== 'direct';
  const row = el('div', 'message-row' + (own ? ' outgoing' : ''));
  row.dataset.message = item.id;
  const sender = senderName(item);
  if (group && !own) row.append(avatar(sender, item.senderPhotoURL));
  const bubble = el('div', 'bubble');
  const hasMedia = !item.deletedForEveryone && chatMedia.handles(item);
  const sticker = hasMedia && chatMedia.isSticker(item);
  const mediaItem = hasMedia ? {
    ...item, thread: threadGeneration, conversationId: activeId, isSticker: sticker, identity: mediaIdentity(item),
  } : undefined;
  if (group && !own) bubble.append(el('p', 'message-author', sender));
  if (item.deletedForEveryone) bubble.append(el('p', 'message-text', t('removed')));
  else {
    if (item.forwarded) bubble.append(el('p', 'message-author', t('forwarded')));
    if (item.replyTo?.messageId) {
      const author = item.replyTo.senderDisplayName || t('peer');
      bubble.append(button(`${author} · ${item.replyTo.preview || t('message')}`, () => jumpTo(item.replyTo.messageId), 'reply-quote'));
    }
    if (mediaItem) {
      const existingMedia = existingRow?.querySelector('.chat-media');
      const key = JSON.stringify([threadGeneration, language, mediaItem.identity, sticker, item.media]);
      const attachment = mediaRenderKeys.get(existingMedia) === key ? existingMedia
        : chatMedia.render(mediaItem);
      mediaRenderKeys.set(attachment, key);
      bubble.append(attachment);
    }
    const rich = richMessage(item, existingRow?.querySelector('.chat-rich-message'));
    if (rich) bubble.append(rich);
    else {
      const body = messageBody(item);
      if (body) bubble.append(renderMessageText(body, body === item.text ? item.mentions : undefined));
      // Older polls can carry labels without option IDs.
      if (item.type === 'poll' && Array.isArray(item.poll?.options)) {
        const options = el('ul', 'live-poll');
        for (const option of item.poll.options) {
          const label = typeof option === 'string' ? option : option?.text;
          if (typeof label === 'string') options.append(el('li', '', label));
        }
        bubble.append(options);
      }
    }
    const entries = messageReactions(item);
    if (entries.length) {
      const reactions = el('div', 'reactions');
      for (const { emoji, uids } of entries) {
        const label = `${emoji} ${numeral(uids.length)}`;
        const chip = button(label, () => openReactionDetails(item.id, emoji, chip), 'reaction');
        chip.title = t('viewReactions');
        chip.setAttribute('aria-label', `${t('viewReactions')} · ${label}`);
        chip.setAttribute('aria-haspopup', 'dialog');
        reactions.append(chip);
      }
      bubble.append(reactions);
    }
    const menuMessage = {
      ...item, conversationId: activeId, session, author: own ? 'you' : 'other', authorLabel: sender,
      text: messageText(item), timeLabel: formatTime(item.createdAt),
      myReactions: entries.filter(({ uids }) => uids.includes(user.uid)).map(({ emoji }) => emoji),
      pinned: currentThread.conversation.pinnedMessage?.messageId === item.id,
      starred: currentThread.userState?.starredMessageIds?.includes(item.id) ?? false,
      canReply: ['text', 'image', 'voice'].includes(item.type) && !sendingRestricted(),
      canEdit: own && item.type === 'text', canDelete: own,
      canPin: !group || currentThread.role === 'owner' || currentThread.role === 'admin',
      canDownload: chatMedia.canDownload(mediaItem), mediaItem,
      canEscalate: canSendViaOfflineSms(item),
    };
    const actions = iconButton('m6 9 6 6 6-6', t('actions'),
      () => tools.showMessageActions(menuMessage, actions), 'message-action message-menu-toggle');
    const react = iconButton('M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-12 2a3.5 3.5 0 0 0 6 0m-6-5h.01m6 0h.01',
      t('quickReaction'), () => tools.showMessageActions(menuMessage, react, { reactionsOnly: true }), 'message-action quick-reaction');
    for (const node of [actions, react]) {
      node.setAttribute('aria-haspopup', 'dialog');
      node.setAttribute('aria-expanded', 'false');
    }
    bubble.append(actions);
    row.append(bubble, react);
  }
  const meta = el('p', 'message-meta');
  if (item.editedAt && !item.deletedForEveryone) meta.append(el('span', '', t('edited')));
  if (currentThread.userState?.starredMessageIds?.includes(item.id)) meta.append(el('span', 'message-star', '★'));
  if (group && own && !item.deletedForEveryone) meta.append(groupReceiptCounters(item));
  meta.append(el('time', '', formatTime(item.createdAt)));
  if (!group && own && !item.deletedForEveryone) {
    const state = item.readCount > 0 || item.status === 'read' ? 'read'
      : item.deliveredCount > 0 || item.status === 'delivered' ? 'delivered' : item.status === 'sent' ? 'sent' : '';
    if (state) {
      const check = el('span', state === 'read' ? 'checks' : '', state === 'sent' ? '✓' : '✓✓');
      check.setAttribute('aria-label', t(state));
      check.title = t(state);
      meta.append(check);
    }
  }
  bubble.append(meta);
  if (!bubble.parentNode) row.append(bubble);
  return row;
}

function renderThreadHeader() {
  const item = currentThread?.conversation || conversations.find((candidate) => candidate.id === activeId);
  byId('conversation-search').classList.toggle('group-search-button', item?.type === 'group');
  const title = item ? threadName(item) : t('chats');
  byId('chat-title').textContent = title;
  byId('chat-description').textContent = !item ? '' : item.type === 'direct' ? t('direct')
    : `${numeral(item.memberCount ?? item.participantUids?.length ?? 0)} ${t('members')}`;
  const peer = profiles.get(peerId(item));
  byId('chat-avatar').replaceChildren(...(item ? [avatar(title, peer?.photoURL || item.avatarUrl)] : []));
  for (const id of ['wallpaper', 'conversation-search', 'details']) byId(id).hidden = !currentThread;
}

function sendingRestricted() {
  const item = currentThread?.conversation;
  if (!item) return true;
  if (item.status === 'disabled') return true;
  if (item.type !== 'group') return item.status === 'locked';
  if (!currentThread.role) return true;
  return (item.status === 'locked' || item.settings?.onlyAdminsCanSend === true)
    && !['owner', 'admin'].includes(currentThread.role);
}

function updateDraft() {
  drafts.set(activeId, messageInput.value);
  updateComposer();
}

function updateComposer() {
  const sending = sends.get(activeId)?.busy === true || attachmentSends.has(activeId);
  const canSend = Boolean(currentThread && !sendingRestricted());
  composerArea.hidden = !canSend;
  byId('chat-blocked').hidden = !currentThread || !sendingRestricted();
  byId('send').hidden = false;
  byId('send').disabled = !canSend || sending || !messageInput.value.trim();
  byId('extras').disabled = sending;
  byId('attach').disabled = !canSend || sending;
  messageInput.readOnly = sending;
  const canMention = canSend && !sending && section === 'chats' && workspace.dataset.mobileView === 'chat'
    && currentThread.conversation.type === 'group';
  mentionComposer.setContext(canMention ? activeId : null);
  const error = sends.get(activeId)?.error;
  feedback.hidden = !error;
  feedback.textContent = error ? t('sendError') : '';
}

function renderReply() {
  const slot = byId('reply-preview');
  const item = replies.get(activeId);
  slot.hidden = !item;
  slot.replaceChildren();
  if (!item) return;
  const cancel = button('×', () => { replies.delete(activeId); renderReply(); messageInput.focus(); }, '');
  cancel.setAttribute('aria-label', t('cancelReply'));
  slot.append(el('span', '', `${t('replyTo')} ${item.senderDisplayName} · ${item.preview}`), cancel);
}

function renderThread(follow = false) {
  renderThreadHeader();
  renderReply();
  updateComposer();
  const pin = byId('pinned-message');
  pin.hidden = !currentThread?.conversation.pinnedMessage;
  pin.replaceChildren();
  if (!currentThread) {
    chatMedia.reset();
    renderedThread = undefined;
    const notice = el('div', 'live-thread-empty', t(!activeId ? 'choose' : threadError ? 'loadFailed' : 'loading'));
    if (threadError) notice.append(button(t('retry'), () => openThread(activeId), 'feature-button live-retry'));
    flow.replaceChildren(notice);
    updateLatest();
    return;
  }
  const pinned = currentThread.conversation.pinnedMessage;
  if (pinned?.messageId) {
    const preview = button('', () => jumpTo(pinned.messageId), 'pinned-preview');
    preview.append(el('strong', '', t('pinned')), el('span', '', pinned.preview || ''));
    pin.append(preview);
  }
  // A user-state snapshot can change unread without changing any message row.
  const rowsState = JSON.stringify([activeId, language, clock, currentThread.conversation.type,
    currentThread.conversation.pinnedMessage?.messageId, currentThread.role, sendingRestricted(),
    currentThread.userState?.starredMessageIds, currentThread.messages]);
  if (renderedThread === rowsState) { updateLatest(); return; }
  renderedThread = rowsState;
  tools.dismiss();
  const existingRows = new Map([...flow.children].map((row) => [row.dataset.message, row]));
  const previousTop = scroll.scrollTop;
  const rows = currentThread.messages.map((item) => renderMessage(item, existingRows.get(item.id)));
  flow.replaceChildren(...(rows.length ? rows : [el('p', 'live-thread-empty', t('noMessages'))]));
  chatMedia.prune();
  scroll.scrollTop = follow ? scroll.scrollHeight : previousTop;
  updateLatest();
}

function updateLatest() {
  latest.hidden = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 70;
}

function showMessageSearch() {
  const content = el('div', 'message-search');
  const input = el('input', 'feature-input');
  input.type = 'search';
  input.placeholder = t('findMessages');
  input.setAttribute('aria-label', t('findMessages'));
  const results = el('div', 'message-search-results');
  content.append(input, results);
  input.addEventListener('input', () => {
    const query = input.value.trim().toLocaleLowerCase(language);
    const rows = query ? (currentThread?.messages ?? []).filter((item) => messageText(item).toLocaleLowerCase(language).includes(query)) : [];
    results.replaceChildren(...(rows.length ? rows.map((item) => button(messageText(item), () => { closeDialog(); jumpTo(item.id); })) : query ? [el('p', 'dialog-note', t('noMessages'))] : []));
  });
  showDialog(t('findMessages'), content);
  input.focus();
}

function showDetails() {
  const item = currentThread?.conversation;
  if (!item) return;
  if (item.type === 'group' && currentThread.role) { openGroupInfo(); return; }
  const content = el('div');
  content.append(el('p', 'dialog-note', byId('chat-description').textContent));
  if (item.description) content.append(el('p', 'dialog-note', item.description));
  if (mobile.matches) content.append(button(t('findMessages'), showMessageSearch));
  showDialog(threadName(item), content);
}

function showNewChat() {
  const form = el('form', 'feature-form');
  const input = el('input', 'feature-input');
  input.maxLength = 21;
  input.autocomplete = 'off';
  input.dir = 'ltr';
  input.placeholder = '@username';
  input.setAttribute('aria-label', t('username'));
  const submit = el('button', 'feature-button feature-primary', t('find'));
  submit.type = 'submit';
  const result = el('div', 'feature-form');
  form.append(input, submit, result);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = input.value.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$/.test(name) || /[._]{2}/.test(name)) { result.textContent = t('noUser'); return; }
    const generation = session;
    result.textContent = t('loading');
    submit.disabled = true;
    try {
      const match = await client.findByUsername(name);
      if (generation !== session || !form.isConnected) return;
      if (!match || match.uid === user.uid) { result.textContent = t('noUser'); return; }
      const start = button(t('openChat'), async () => {
        start.disabled = true;
        try {
          const data = await call('getOrCreateDirectConversation', { otherUserId: match.uid });
          if (generation !== session || !form.isConnected || !data?.conversationId) return;
          profiles.set(match.uid, match);
          closeDialog();
          filter = 'all';
          search.value = '';
          openThread(data.conversationId);
        } catch {
          if (generation === session && form.isConnected) result.textContent = t('actionFailed');
        }
      });
      result.replaceChildren(el('p', '', match.displayName || match.username), start);
    } catch {
      if (generation === session && form.isConnected) result.textContent = t('actionFailed');
    } finally {
      if (generation === session && form.isConnected) submit.disabled = false;
    }
  });
  showDialog(t('newChat'), form);
  input.focus();
}

function choice(title, options, selected, onChange) {
  const card = el('section', 'feature-card live-preferences');
  const controls = el('div', 'feature-toolbar');
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', title);
  for (const [value, label] of options) {
    const item = button(t(label), () => {
      for (const sibling of controls.children) sibling.setAttribute('aria-pressed', String(item === sibling));
      onChange(value);
    }, 'feature-button');
    item.setAttribute('aria-pressed', String(value === selected));
    controls.append(item);
  }
  card.append(el('h2', '', title), controls);
  return card;
}

function chooseWallpaper(next) {
  wallpaper = next;
  applyWallpaper();
}

function chatWallpaperKey() {
  return `wallpaper-${user?.uid}-${activeId}`;
}

function applyWallpaper() {
  const choice = user && activeId ? preference(chatWallpaperKey(), ['inherit', 'default', 'plain'], 'inherit') : 'inherit';
  const effective = choice === 'inherit' ? wallpaper : { type: choice };
  const panel = scroll.closest('.conversation');
  panel.dataset.wallpaper = effective.type;
  if (effective.type === 'custom') panel.style.setProperty('--custom-chat-wallpaper', `url("${effective.url}")`);
  else panel.style.removeProperty('--custom-chat-wallpaper');
}

function showGroupWallpaper() {
  const key = chatWallpaperKey();
  const options = [['inherit', 'useDefaultWallpaper'], ['default', 'defaultWallpaper'], ['plain', 'plainWallpaper']];
  showDialog(t('wallpaper'), choice(t('wallpaper'), options, preference(key, options.map(([value]) => value), 'inherit'), (next) => {
    savePreference(key, next);
    applyWallpaper();
  }));
}

function disposeSettings() {
  settingsPage?.dispose();
  settingsPage = profileSettings = undefined;
}

function openProfileSettings(title) {
  if (!user) return;
  const generation = session;
  const content = el('div', 'settings-profile-editor');
  const photoField = el('label', 'settings-profile-photo');
  const preview = el('span');
  const file = el('input');
  file.type = 'file';
  file.accept = 'image/jpeg,image/png,image/webp';
  file.setAttribute('aria-label', t('profilePhoto'));
  const photoStatus = el('p', 'dialog-note');
  photoStatus.setAttribute('role', 'status');
  const active = () => generation === session && content.isConnected && dialog.open;
  const updatePhoto = () => preview.replaceChildren(avatar(user.displayName || title, user.photoURL));
  updatePhoto();
  photoField.append(preview, el('span', '', t('profilePhoto')), file);
  profileSettings = createProfileSettings({
    locale: language,
    profile: user,
    save: changes => client.updateOwnProfile(changes),
    isActive: active,
  });
  file.addEventListener('change', async () => {
    const photo = file.files?.[0];
    if (!photo || !active() || file.disabled) return;
    file.disabled = true;
    photoStatus.textContent = t('loading');
    try {
      const photoURL = await client.updateOwnPhoto(photo);
      if (!active()) return;
      user.photoURL = photoURL;
      settingsPage?.update(user);
      updatePhoto();
      photoStatus.textContent = t('profilePhotoSaved');
    } catch (error) {
      if (active()) photoStatus.textContent = t(error?.code === 'invalid-profile-photo' ? 'profilePhotoInvalid' : 'profilePhotoFailed');
    } finally {
      file.value = '';
      file.disabled = false;
    }
  });
  content.append(photoField, photoStatus, profileSettings.element);
  showDialog(title, content);
}

function applyAccountAppearance(profile) {
  if (profile.preferredTheme && profile.preferredTheme !== theme) {
    theme = profile.preferredTheme;
    savePreference('theme', theme);
    applyTheme();
  }
  const timeChanged = profile.timeFormat && profile.timeFormat !== clock;
  if (timeChanged) {
    clock = profile.timeFormat;
    savePreference('clock', clock);
  }
  if (profile.preferredLanguage && profile.preferredLanguage !== language) setLanguage(profile.preferredLanguage);
  else if (timeChanged && section === 'chats') { renderList(); renderThread(); }
}

async function signOutWeb() {
  const generation = session;
  workspace.hidden = true;
  signIn.showLoading();
  try {
    await client.signOut();
    return true;
  } catch {
    if (generation === session) {
      signIn.hide();
      workspace.hidden = false;
    }
    return false;
  }
}

function showSettings() {
  if (settingsPage && dialog.open) closeDialog();
  disposeSettings();
  const text = settingsLabels[language];
  const content = el('section', 'feature-settings-layout');
  content.dataset.view = 'overview';
  const overview = el('div', 'feature-settings-overview');
  overview.append(el('h1', 'sr-only', text.title));
  content.append(overview);
  const generation = session;
  const active = () => generation === session && section === 'settings' && content.isConnected;
  const { row, card, profileHeader, options } = createSettingsLayout({ outlineIcon, avatar });
  const header = profileHeader(text.profile, text.editProfileHint, () => openProfileSettings(text.profile));
  const common = { locale: language, client, user, row, showDialog, closeDialog, isActive: active, announce };
  const account = createSettingsAccountSecurity({ ...common, onAccountRefreshed({ email, phone }) {
    if (!active()) return;
    user.email = email;
    user.phoneNumber = phone;
    header.update(user);
  } });
  const friends = createSettingsFriendsWallpaper({ ...common, wallpaper, applyWallpaper: chooseWallpaper,
    openDirect(id, profile) {
      if (!active()) return;
      if (profile?.uid) profiles.set(profile.uid, profile);
      navigate('chats');
      openThread(id);
    },
  });
  const preferences = createSettingsPreferences({ ...common, openFindFriends: friends.openFindFriends });
  const devicePoints = createSettingsDevicesPoints({ ...common,
    getLocalCounts: () => ({ chats: conversations.length, messages: [...localMessageCounts.values()].reduce((a, b) => a + b, 0) }),
  });
  const support = createSettingsSupport({ ...common,
    onAccountDeletionPending(uid, pending) {
      if (user?.uid === uid && generation === session) accountDeletionUid = pending ? uid : undefined;
    },
    onAccountDeleted(uid, result) {
      if (user?.uid === uid && generation === session && !result.signedOut) {
        void signOutWeb().then(success => {
          if (!success && user?.uid === uid && generation === session) authChanged(null);
        });
      }
    },
  });
  const saveChoice = (key) => async value => {
    const patch = { [key]: value };
    await client.updateAccountAppearance(patch);
    if (generation === session) applyAccountAppearance(patch);
  };
  const choiceError = () => announce(text.updateFailed);
  const languages = options(text.language, [['en', 'English'], ['ar', 'العربية']], language, saveChoice('preferredLanguage'), choiceError, active);
  const themes = options(text.theme, [['system', text.themeSystem], ['light', text.themeLight], ['dark', text.themeDark]],
    theme, saveChoice('preferredTheme'), choiceError, active);
  const times = options(text.timeFormat, [['system', text.timeFormatSystem], ['12h', text.timeFormat12], ['24h', text.timeFormat24]],
    clock, saveChoice('timeFormat'), choiceError, active);
  const legal = card(
    row({ label: text.privacyPolicy, icon: 'privacyPolicy', href: 'https://offlinesms.com/offlinesms-privacy-policy.html' }),
    row({ label: text.termsOfService, icon: 'terms', href: 'https://offlinesms.com/offlinesms-terms-of-service.html' }),
  );
  const error = el('p', 'dialog-note');
  error.setAttribute('role', 'status');
  const logout = row({ label: text.signOut, icon: 'signOut', danger: true, async onClick() {
    logout.disabled = true;
    if (!await signOutWeb() && active()) {
      logout.disabled = false;
      error.textContent = t('signOutFailed');
    }
  } });
  overview.append(header.element,
    card(friends.friends, account.email, account.phone, account.pin, preferences.permissions),
    card(devicePoints.points, preferences.sms, preferences.inApp),
    card(friends.wallpaper, preferences.notifications),
    languages.element, themes.element, times.element,
    card(devicePoints.devices), devicePoints.storage,
    card(support.help), legal, card(support.deleteAccount),
    card(row({ label: text.appVersion, icon: 'version', trailing: webVersion }), logout), error,
  );
  settingsPage = {
    update(profile) {
      header.update(profile);
      preferences.update(profile);
      profileSettings?.update(profile);
      languages.update(language);
      themes.update(theme);
      times.update(clock);
    },
    updateNotifications: preferences.updateNotifications,
    dispose() {
      account.dispose?.();
      preferences.dispose?.();
      support.dispose();
      devicePoints.dispose();
    },
  };
  featurePanel.replaceChildren(content);
  settingsPage.update(user);
  settingsPage.updateNotifications(notificationPreferences);
}

function renderSection() {
  if (section === 'settings') showSettings();
  else feeds.render(section);
}

function navigate(next) {
  closeMessageInfo();
  closeGroupInfo();
  tools.dismiss();
  closeDialog();
  if (section !== next) {
    closeMedia();
    renderedThread = undefined;
    feeds.stop();
    featurePanel.scrollTop = 0;
  }
  section = next;
  if (next !== 'settings') disposeSettings();
  chatReceipts.refreshVisibility();
  main.dataset.section = next;
  navigation.forEach((node) => {
    if (node.dataset.section === next) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  });
  featurePanel.hidden = next === 'chats';
  if (next === 'chats') {
    featurePanel.replaceChildren();
    renderList();
    renderThread();
    maybeMarkRead();
  } else {
    mentionComposer.setContext(null);
    renderSection();
  }
}

function call(name, data) {
  if (!user) return Promise.reject(new Error('Authentication required'));
  return client.call(name, data);
}

function chatAction(name, payload, conversationId) {
  if (!activeId || conversationId !== activeId || !currentThread) return Promise.reject(new Error('Conversation required'));
  return call(name, { conversationId, ...payload });
}

function chatMessageAction(name, message, payload = {}) {
  return chatAction(name, { messageId: message.id, ...payload }, message.conversationId);
}

function closeMessageInfo() {
  if (messageInfoPanel.hidden) return;
  messageInfoPanel.hidden = true;
  messageInfoPanel.replaceChildren();
  delete main.dataset.messageInfo;
}

function closeGroupInfo() {
  if (!groupInfo) return;
  const view = groupInfo;
  groupInfo = undefined;
  view.stop();
  closeDialog();
  groupInfoPanel.hidden = true;
  groupInfoPanel.replaceChildren();
  delete main.dataset.groupInfo;
}

function openGroupInfo() {
  const uid = user.uid;
  const conversationId = activeId;
  const generation = threadGeneration;
  const getContext = () => {
    const { conversation, role } = currentThread ?? {};
    if (generation === threadGeneration && user?.uid === uid && conversation?.type === 'group' && role) return { conversation, role, uid };
    return undefined;
  };
  if (!getContext()) return;
  closeMessageInfo();
  closeGroupInfo();
  tools.dismiss();
  closeDialog();
  const ready = createGroupInfo({
    locale: language, uid, conversationId, client, call, getContext,
    isActive: () => groupInfo === ready && Boolean(getContext()),
    showDialog, closeDialog, formatTime, makeAvatar: avatar, groupName: threadName,
    onWallpaper: showGroupWallpaper,
    onOpenDirect: (id) => { filter = 'all'; search.value = ''; openThread(id); },
    onLeft: (id, actor) => {
      if (generation !== threadGeneration || id !== activeId || actor !== user?.uid) return;
      closeMedia();
      closeGroupInfo();
      stopThread?.();
      stopThread = undefined;
      ++threadGeneration;
      activeId = currentThread = pendingRead = renderedThread = undefined;
      threadError = false;
      conversations = conversations.filter((item) => item.id !== id);
      workspace.dataset.mobileView = 'list';
      messageInput.value = '';
      mentionComposer.clear(id);
      applyWallpaper();
      renderList();
      renderThread();
    },
    onBack: () => { closeGroupInfo(); byId('details').focus({ preventScroll: true }); maybeMarkRead(); },
  });
  groupInfo = ready;
  groupInfoPanel.replaceChildren(ready.view);
  groupInfoPanel.hidden = false;
  main.dataset.groupInfo = '';
  workspace.dataset.mobileView = 'chat';
  chatReceipts.refreshVisibility();
  ready.start();
}

function openMessageInfo(message, viaSms = false) {
  if (!user || message.session !== session || message.conversationId !== activeId || !currentThread) return;
  if (viaSms) {
    const current = currentThread.messages.find((item) => item.id === message.id);
    if (!canSendViaOfflineSms(current)) { announce(t('actionFailed')); return; }
    message = { ...message, text: current.text ?? '' };
  }
  closeDialog();
  const generation = threadGeneration;
  const conversation = currentThread.conversation;
  const info = createMessageInfo({
    message, title: threadName(conversation),
    memberCount: conversation.type === 'group' ? conversation.memberCount ?? conversation.participantUids?.length : undefined,
    locale: language, formatTime, makeAvatar: avatar, call,
    isActive: () => generation === threadGeneration && info.view.isConnected && !messageInfoPanel.hidden,
    onBack: () => {
      closeMessageInfo();
      const row = [...flow.children].find((node) => node.dataset.message === message.id);
      (row?.querySelector('.message-menu-toggle') ?? byId('chat-title')).focus({ preventScroll: true });
      maybeMarkRead();
    },
  });
  messageInfoPanel.replaceChildren(info.view);
  messageInfoPanel.hidden = false;
  main.dataset.messageInfo = '';
  chatReceipts.refreshVisibility();
  if (viaSms) info.openSms();
  else {
    info.focus();
    void info.load();
  }
}

const feeds = createLiveFeeds({ panel: featurePanel, getLanguage: () => language, call, formatTime });
const signIn = createSignInView({
  container: byId('web-sign-in'), getLanguage: () => language, setLanguage,
  hasGroupInvite: () => Boolean(inviteCodeFromLocation()),
  requestCode: (email) => client.requestEmailOtp(email),
  verifyCode: (email, code) => client.verifyEmailOtp(email, code),
  getPhoneAvailability: () => client.getPhoneAvailability(),
  requestPhoneCode: (phone, options) => client.requestPhoneCode(phone, options),
  verifyPhoneCode: (challengeId, code, options) => client.verifyPhoneCode(challengeId, code, options),
  resetPhoneFlow: () => client?.resetPhoneFlow(),
  phoneErrorInfo: (error) => client.phoneErrorInfo(error),
  signOut: () => client.signOut(),
});
const inviteView = createGroupInviteView({
  getClient: () => client, getUser: () => user, getLocale: () => language, showDialog, closeDialog, clearInvite,
  isCurrentInvite: (code) => code === inviteCodeFromLocation(),
  openGroup(id) {
    navigate('chats');
    filter = 'all';
    search.value = '';
    openThread(id);
  },
});
const tools = createChatTools({
  getLanguage: () => language, showDialog, closeDialog, announce,
  canUseMessage: (item) => Boolean(user && item.session === session && item.conversationId === activeId && currentThread),
  getThreads: () => conversations.filter((item) => item.id !== activeId && canSeeThread(item)).map((item) => ({ id: item.id, name: threadName(item) })),
  setReply: (item) => {
    if (!currentThread || item.conversationId !== activeId || sendingRestricted()) return;
    replies.set(activeId, {
      messageId: item.id, senderUid: item.senderUid ?? item.senderId,
      senderDisplayName: senderName(item), preview: messageText(item).slice(0, 120), type: item.type,
    });
    renderReply();
    messageInput.focus();
  },
  updateMessage: (id, text, item) => chatAction('editMessage', { messageId: id, text }, item.conversationId),
  deleteMessage: (id, item) => chatAction('deleteMessage', { messageId: id, mode: 'for_everyone' }, item.conversationId),
  toggleReaction: (id, emoji, item) => chatAction('reactToMessage', { messageId: id, emoji }, item.conversationId),
  togglePin: (item) => chatMessageAction('pinMessage', item, { pinned: !item.pinned }),
  toggleStar: (item) => chatMessageAction('starMessage', item, { starred: !item.starred }),
  downloadAttachment: (item) => chatMedia.download(item.mediaItem),
  openMessageSms: (item) => openMessageInfo(item, true),
  openMessageInfo,
  forwardMessage: (id, item) => item.conversationId === activeId ? call('forwardMessages', {
    sourceConversationId: item.conversationId, messageIds: [item.id], targetConversationIds: [id],
  }) : Promise.reject(new Error('Conversation required')),
});

function showComposerOptions() {
  const grid = el('div', 'emoji-grid');
  for (const emoji of ['😊', '😂', '❤️', '👍', '🎉', '🙏', '👋', '🤔', '🙌', '✅', '☕', '⭐']) {
    grid.append(button(emoji, () => {
      closeDialog();
      const start = messageInput.selectionStart;
      const end = messageInput.selectionEnd;
      messageInput.setRangeText(emoji, start, end, 'end');
      mentionComposer.refresh({ start, end });
      updateDraft();
      messageInput.focus();
    }, 'feature-button'));
  }
  showDialog(t('composerOptions'), grid);
}

function showAttachments() {
  const conversationId = activeId;
  if (!user || section !== 'chats' || sendingRestricted() || sends.get(conversationId)?.busy || attachmentSends.has(conversationId)) return;
  disposeAttachments();
  const generation = threadGeneration;
  const owner = session;
  const replyTo = replies.get(conversationId) ?? null;
  const isActive = () => owner === session && generation === threadGeneration && section === 'chats' && !sendingRestricted();
  async function sendAttachment(operation, includeReply = true) {
    if (!isActive() || attachmentSends.has(conversationId)) throw new Error('conversation-unavailable');
    const attempt = {};
    attachmentSends.set(conversationId, attempt);
    updateComposer();
    try {
      await operation();
      if (includeReply && owner === session && replies.get(conversationId) === replyTo) replies.delete(conversationId);
      if (generation === threadGeneration) renderReply();
    } finally {
      if (attachmentSends.get(conversationId) === attempt) attachmentSends.delete(conversationId);
      if (activeId === conversationId && owner === session) updateComposer();
    }
  }

  const context = {
    locale: language, isActive, closeDialog,
    showDialog: (title, content) => showDialog(title, content, true),
  };
  attachments = createChatAttachments({
    ...context,
    sendAttachment: (payload) => sendAttachment(() => client.sendAttachment({ ...payload, conversationId, replyTo })),
    openStructured: (kind) => openStructuredAttachment(kind, {
      ...context,
      call: (name, data) => isActive() ? call(name, data) : Promise.reject(new Error('conversation-unavailable')),
      sendRich: (rich, localId) => sendAttachment(() => call(
        rich.kind === 'poll' && rich.poll.anonymous ? 'sendPollMessage' : 'sendTextMessage',
        { ...rich, conversationId, localId, ...(rich.kind !== 'poll' && replyTo ? { replyTo } : {}) },
      ), rich.kind !== 'poll'),
    }),
  });
  attachments.open();
}

async function send(event) {
  event.preventDefault();
  const text = messageInput.value.trim();
  const id = activeId;
  const replyTo = replies.get(id) || null;
  if (!id || !text || !currentThread || sends.get(id)?.busy || attachmentSends.has(id) || sendingRestricted()) return;
  const generation = session;
  const previous = sends.get(id);
  const mentions = currentThread.conversation.type === 'group'
    ? mentionComposer.mentionsFor(id, text, currentThread.conversation.participantUids) : [];
  const mentionKey = JSON.stringify(mentions);
  const attempt = previous?.text === text && previous?.replyTo?.messageId === replyTo?.messageId && previous?.mentionKey === mentionKey
    ? previous : { text, replyTo, mentionKey, localId: crypto.randomUUID() };
  sends.set(id, attempt);
  attempt.busy = true;
  attempt.error = false;
  updateComposer();
  try {
    await client.sendText({ conversationId: id, text, replyTo, localId: attempt.localId, mentions: mentions.length ? mentions : null });
    if (generation !== session) return;
    sends.delete(id);
    drafts.delete(id);
    replies.delete(id);
    if (activeId === id) {
      messageInput.value = '';
      renderReply();
      messageInput.focus();
    }
    mentionComposer.clear(id);
  } catch {
    if (generation === session) attempt.error = true;
  } finally {
    if (generation === session) {
      attempt.busy = false;
      if (activeId === id) updateComposer();
    }
  }
}

function clearSession() {
  chatReceipts.reset();
  mentionComposer.reset();
  mentionRoster = undefined;
  disposeSettings();
  accountDeletionUid = undefined;
  closeMedia();
  ++session;
  ++threadGeneration;
  stopList?.();
  stopThread?.();
  stopNotificationPreferences?.();
  stopNotificationPreferences = undefined;
  notificationPreferences = DEFAULT_NOTIFICATION_PREFERENCES;
  for (const notice of connectedNotifications.values()) notice.close();
  connectedNotifications.clear();
  pendingConversationAlerts.clear();
  localMessageCounts.clear();
  for (const stop of stopStates.values()) stop();
  stopList = stopThread = undefined;
  stopStates.clear();
  profiles.clear();
  userStates.clear();
  drafts.clear();
  replies.clear();
  sends.clear();
  attachmentSends.clear();
  conversations = [];
  listState = 'loading';
  activeId = currentThread = pendingRead = undefined;
  chooseWallpaper(readBrowserWallpaper(undefined, wallpaperFallback));
  renderedThread = undefined;
  threadError = false;
  closeMessageInfo();
  closeGroupInfo();
  tools.dismiss();
  feeds.stop();
  closeDialog();
  featurePanel.replaceChildren();
  byId('chat-title').textContent = '';
  byId('chat-description').textContent = '';
  byId('chat-avatar').replaceChildren();
  byId('pinned-message').replaceChildren();
  byId('reply-preview').replaceChildren();
  list.replaceChildren();
  flow.replaceChildren();
  search.value = messageInput.value = '';
  announce('');
  workspace.dataset.mobileView = 'list';
}

function authChanged(next) {
  const generation = ++accountWatch;
  stopAccount?.();
  stopAccount = undefined;
  workspace.hidden = true;
  clearSession();
  user = undefined;
  if (!next) {
    signIn.showSignIn();
    return;
  }
  signIn.showLoading();
  stopAccount = client.watchAccount(next.uid, (profile) => {
    if (generation !== accountWatch) return;
    if (!profile && accountDeletionUid === next.uid) return;
    if (!profile || profile.status !== 'active') {
      workspace.hidden = true;
      clearSession();
      user = undefined;
      signIn.showBlocked();
      return;
    }
    if (user?.uid === next.uid) {
      Object.assign(user, profile);
      applyAccountAppearance(profile);
      settingsPage?.update(user);
      return;
    }
    user = { ...next, ...profile };
    signIn.hide();
    filter = 'all';
    navigate('chats');
    applyAccountAppearance(profile);
    chooseWallpaper(readBrowserWallpaper(user.uid, wallpaperFallback));
    workspace.hidden = false;
    stopNotificationPreferences = client.watchNotificationPreferences?.(user.uid, values => {
      if (generation !== accountWatch || user?.uid !== next.uid) return;
      notificationPreferences = values;
      settingsPage?.updateNotifications(values);
    }, () => {});
    subscribeList();
    showGroupInvite();
  }, () => {
    if (generation !== accountWatch) return;
    workspace.hidden = true;
    clearSession();
    user = undefined;
    signIn.showError();
  });
}

navigation.forEach((item) => item.addEventListener('click', () => navigate(item.dataset.section)));
filters.forEach((item) => item.addEventListener('click', () => { filter = item.dataset.filter; renderList(); }));
search.addEventListener('input', renderList);
byId('chat-settings').addEventListener('click', () => navigate('settings'));
byId('new-chat').addEventListener('click', showNewChat);
inviteShortcut.addEventListener('click', showGroupInvite);
window.addEventListener('hashchange', showGroupInvite);
byId('details').addEventListener('click', showDetails);
byId('conversation-search').addEventListener('click', showMessageSearch);
byId('wallpaper').addEventListener('click', showGroupWallpaper);
byId('extras').addEventListener('click', showComposerOptions);
byId('attach').addEventListener('click', showAttachments);
byId('back').addEventListener('click', () => {
  if (attachments) closeDialog();
  closeGroupInfo();
  workspace.dataset.mobileView = 'list';
  mentionComposer.setContext(null);
  chatReceipts.refreshVisibility();
  [...list.querySelectorAll('[data-thread]')].find((item) => item.dataset.thread === activeId)?.focus({ preventScroll: true });
});
latest.addEventListener('click', () => { scroll.scrollTop = scroll.scrollHeight; scroll.focus({ preventScroll: true }); });
scroll.addEventListener('scroll', () => { updateLatest(); chatReceipts.refreshVisibility(); }, { passive: true });
messageInput.addEventListener('input', updateDraft);
messageInput.addEventListener('keydown', (event) => {
  if (mentionComposer.keydown(event)) return;
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    if (!byId('send').disabled) composer.requestSubmit();
  }
});
composer.addEventListener('submit', send);
document.addEventListener('visibilitychange', maybeMarkRead);
window.addEventListener('focus', maybeMarkRead);
window.addEventListener('blur', chatReceipts.refreshVisibility);
window.addEventListener('resize', chatReceipts.refreshVisibility);
if (typeof ResizeObserver === 'function') {
  const receiptLayout = new ResizeObserver(chatReceipts.refreshVisibility);
  receiptLayout.observe(scroll);
  receiptLayout.observe(flow);
}
darkMode.addEventListener('change', applyTheme);
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) chatReceipts.stop();
  if (attachments) closeDialog();
  if (!event.persisted) { stopAccount?.(); stopNotificationPreferences?.(); disposeSettings(); unsubscribeAuth?.(); }
});
dialog.addEventListener('close', () => {
  if (!dialog.open) {
    profileSettings = undefined;
    disposeAttachments();
    viewingMedia = viewingReactions = undefined;
    byId('dialog-content').replaceChildren();
    chatReceipts.refreshVisibility();
  }
});

applyTheme();
chooseWallpaper(wallpaper);
setLanguage(language);
signIn.showLoading();
try {
  client = await loadFirebaseClient();
  unsubscribeAuth = client.watchAuth(authChanged, () => {
    ++accountWatch;
    stopAccount?.();
    stopAccount = undefined;
    workspace.hidden = true;
    clearSession();
    user = undefined;
    signIn.showError();
  });
} catch {
  signIn.showError();
}
