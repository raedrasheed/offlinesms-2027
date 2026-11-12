import { loadFirebaseClient } from './firebase-bootstrap.js';
import { createSignInView } from './web-sign-in.js';
import { createLiveFeeds } from './live-feeds.js';
import { createChatTools } from './chat-tools.js';

const words = {
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
  quickReaction: ['تفاعل سريع', 'Quick reaction'], direct: ['محادثة فردية', 'Direct conversation'], group: ['مجموعة', 'Group'],
  members: ['أعضاء', 'members'], peer: ['مستخدم OfflineSMS', 'OfflineSMS user'], you: ['أنت', 'You'],
  replyTo: ['الرد على', 'Replying to'], cancelReply: ['إلغاء الرد', 'Cancel reply'], forwarded: ['معاد توجيهها', 'Forwarded'],
  edited: ['تم التعديل', 'Edited'], pinned: ['رسالة مثبّتة', 'Pinned message'], unpin: ['إلغاء تثبيت الرسالة', 'Unpin message'],
  removed: ['حُذفت هذه الرسالة.', 'This message was deleted.'], sent: ['أُرسلت', 'Sent'],
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
let wallpaper = preference('wallpaper', ['default', 'plain'], 'default');
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
let threadError = false;
let stopList;
let stopThread;
let stopAccount;
let accountWatch = 0;
let unsubscribeAuth;
let pendingRead;
let announcementTimer;
let renderedThread;
const profiles = new Map();
const userStates = new Map();
const stopStates = new Map();
const drafts = new Map();
const replies = new Map();
const sends = new Map();

const t = (key) => words[key]?.[language === 'ar' ? 0 : 1] ?? words.message[language === 'ar' ? 0 : 1];
const numeral = (value) => new Intl.NumberFormat(language).format(value);

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
  const ns = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(ns, 'svg');
  const line = document.createElementNS(ns, 'path');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  line.setAttribute('d', path);
  icon.append(line);
  node.append(icon);
  return node;
}

function applyTheme() {
  const resolved = theme === 'system' ? (darkMode.matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]').content = resolved === 'dark' ? '#191a1a' : '#fff';
}

function formatTime(value) {
  const date = value?.toDate?.() ?? (value instanceof Date ? value : new Date(value ?? NaN));
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

function showDialog(title, content) {
  byId('dialog-title').textContent = title;
  byId('dialog-content').replaceChildren(content);
  if (!dialog.open) dialog.showModal();
  else content.querySelector('button, input, select, textarea')?.focus();
}

function closeDialog() {
  if (dialog.open) dialog.close();
  byId('dialog-content').replaceChildren();
  byId('dialog-title').textContent = '';
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

function subscribeList() {
  stopList?.();
  listState = 'loading';
  renderList();
  const generation = session;
  stopList = client.watchConversations(user.uid, (rows) => {
    if (generation !== session) return;
    listState = 'ready';
    conversations = rows;
    const ids = new Set(rows.map((item) => item.id));
    for (const [id, stop] of stopStates) {
      if (ids.has(id)) continue;
      stop();
      stopStates.delete(id);
      userStates.delete(id);
    }
    for (const item of rows) {
      syncProfile(peerId(item));
      if (stopStates.has(item.id)) continue;
      const stop = client.watchUserState(user.uid, item.id, (state) => {
        if (generation !== session) return;
        userStates.set(item.id, state);
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
    renderList();
  });
}

function openThread(id, focus = true) {
  if (!user) return;
  tools.dismiss();
  stopThread?.();
  activeId = id;
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
    threadError = false;
    syncProfile(peerId(value.conversation));
    const atBottom = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 90;
    if (section === 'chats') {
      renderThread(!previous || atBottom);
      maybeMarkRead();
    }
  }, () => {
    if (generation !== threadGeneration) return;
    currentThread = undefined;
    threadError = true;
    tools.dismiss();
    closeDialog();
    renderThread();
  });
}

function maybeMarkRead() {
  if (!currentThread || section !== 'chats' || workspace.dataset.mobileView !== 'chat' || document.hidden || !document.hasFocus()) return;
  if (!currentThread.userState?.unreadCount) return;
  const incoming = currentThread.messages.findLast((message) => message.senderUid !== user.uid);
  if (!incoming || pendingRead === incoming.id) return;
  const generation = threadGeneration;
  pendingRead = incoming.id;
  client.markRead(activeId).catch(() => {
    if (generation === threadGeneration && pendingRead === incoming.id) pendingRead = undefined;
  });
}

function showMedia(item) {
  const kind = item.type;
  const container = el('div', 'live-media');
  const path = item.media?.storagePath;
  const pathSegments = typeof path === 'string' ? path.split('/') : [];
  if (item.media?.uploadStatus !== 'uploaded' || pathSegments[1] !== activeId || pathSegments[3] !== item.id) {
    container.textContent = t(kind);
    return container;
  }
  const load = button(`${t('mediaLoad')} · ${t(kind)}`, async () => {
    load.disabled = true;
    const generation = threadGeneration;
    try {
      const src = safeMediaUrl(await client.getMediaUrl(path));
      if (!src) throw new Error('Unavailable media');
      if (generation !== threadGeneration || !container.isConnected) return;
      if (kind === 'file') {
        const link = el('a', 'feature-button', item.media?.fileName || t('file'));
        link.href = src;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        container.replaceChildren(link);
        return;
      }
      const node = el(kind === 'voice' || kind === 'audio' ? 'audio' : kind === 'video' ? 'video' : 'img');
      if (node.tagName === 'IMG') { node.alt = t(kind); node.referrerPolicy = 'no-referrer'; }
      else { node.controls = true; node.preload = 'metadata'; node.playsInline = true; }
      node.src = src;
      container.replaceChildren(node);
    } catch {
      if (generation !== threadGeneration || !container.isConnected) return;
      load.disabled = false;
      load.textContent = t('mediaUnavailable') + ' · ' + t('retry');
    }
  }, 'feature-button');
  container.append(load);
  return container;
}

function jumpTo(id) {
  const row = [...flow.children].find((node) => node.dataset.message === id);
  if (!row) { announce(t('noMessages')); return; }
  row.scrollIntoView({ block: 'center' });
  row.querySelector('.message-menu-toggle')?.focus({ preventScroll: true });
  row.classList.add('message-highlight');
  window.setTimeout(() => row.classList.remove('message-highlight'), 1800);
}

function renderMessage(item) {
  const own = (item.senderUid ?? item.senderId) === user.uid;
  const group = currentThread.conversation.type !== 'direct';
  const row = el('div', 'message-row' + (own ? ' outgoing' : ''));
  row.dataset.message = item.id;
  const sender = senderName(item);
  if (group && !own) row.append(avatar(sender, item.senderPhotoURL));
  const bubble = el('div', 'bubble');
  if (group && !own) bubble.append(el('p', 'message-author', sender));
  if (item.deletedForEveryone) bubble.append(el('p', 'message-text', t('removed')));
  else {
    if (item.forwarded) bubble.append(el('p', 'message-author', t('forwarded')));
    if (item.replyTo?.messageId) {
      const author = item.replyTo.senderDisplayName || t('peer');
      bubble.append(button(`${author} · ${item.replyTo.preview || t('message')}`, () => jumpTo(item.replyTo.messageId), 'reply-quote'));
    }
    if (item.media) bubble.append(showMedia(item));
    const body = el('p', 'message-text', item.caption || item.text || (!item.media ? t(item.type) : ''));
    body.dir = 'auto';
    if (body.textContent) bubble.append(body);
    if (item.type === 'poll' && Array.isArray(item.poll?.options)) {
      const options = el('ul', 'live-poll');
      item.poll.options.forEach((option) => {
        const text = typeof option === 'string' ? option : option?.text;
        if (typeof text === 'string') options.append(el('li', '', text));
      });
      bubble.append(options);
    }
    if (item.reactions && typeof item.reactions === 'object') {
      const reactions = el('div', 'reactions');
      for (const [emoji, users] of Object.entries(item.reactions)) {
        if (Array.isArray(users) && users.length) reactions.append(el('span', 'reaction', `${emoji} ${numeral(users.length)}`));
      }
      if (reactions.childElementCount) bubble.append(reactions);
    }
    const menuMessage = {
      ...item, conversationId: activeId, session, author: own ? 'you' : 'other', authorLabel: sender,
      text: messageText(item), timeLabel: formatTime(item.createdAt),
      myReactions: Object.entries(item.reactions || {}).filter(([, users]) => Array.isArray(users) && users.includes(user.uid)).map(([emoji]) => emoji),
      pinned: currentThread.conversation.pinnedMessage?.messageId === item.id,
      starred: currentThread.userState?.starredMessageIds?.includes(item.id) ?? false,
      canReply: ['text', 'image', 'voice'].includes(item.type) && !sendingRestricted(),
      canEdit: own && item.type === 'text', canDelete: own,
      canPin: !group || currentThread.role === 'owner' || currentThread.role === 'admin',
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
  meta.append(el('time', '', formatTime(item.createdAt)));
  if (own && !item.deletedForEveryone) {
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

function updateComposer() {
  const sending = sends.get(activeId)?.busy === true;
  const canSend = Boolean(currentThread && !sendingRestricted());
  composerArea.hidden = !canSend;
  byId('chat-blocked').hidden = !currentThread || !sendingRestricted();
  byId('send').hidden = false;
  byId('send').disabled = !canSend || sending || !messageInput.value.trim();
  byId('extras').disabled = sending;
  messageInput.readOnly = sending;
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
  const previousTop = scroll.scrollTop;
  const rows = currentThread.messages.map(renderMessage);
  flow.replaceChildren(...(rows.length ? rows : [el('p', 'live-thread-empty', t('noMessages'))]));
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
  scroll.closest('.conversation').dataset.wallpaper = next;
  savePreference('wallpaper', next);
}

function showSettings() {
  const content = el('div', 'live-settings');
  content.append(el('h1', '', t('settings')));
  const identity = el('section', 'feature-card live-preferences');
  const account = el('p', '', user.email || user.phoneNumber || t('peer'));
  account.dir = 'auto';
  const logout = button(t('signOut'), async () => {
    const generation = session;
    logout.disabled = true;
    workspace.hidden = true;
    signIn.showLoading();
    try { await client.signOut(); } catch {
      if (generation !== session) return;
      signIn.hide();
      workspace.hidden = false;
      logout.disabled = false;
      error.textContent = t('signOutFailed');
    }
  }, 'feature-button');
  const error = el('p', 'dialog-note');
  error.setAttribute('role', 'status');
  identity.append(el('h2', '', t('account')), account, logout, error);
  content.append(identity);
  const languages = el('section', 'feature-card live-preferences');
  const controls = el('div', 'feature-toolbar');
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', t('language'));
  for (const [value, label] of [['ar', 'العربية'], ['en', 'English']]) {
    const item = button(label, () => setLanguage(value), 'feature-button');
    item.setAttribute('aria-pressed', String(value === language));
    controls.append(item);
  }
  languages.append(el('h2', '', t('language')), controls);
  content.append(languages,
    choice(t('appearance'), [['system', 'system'], ['dark', 'dark'], ['light', 'light']], theme, (next) => { theme = next; savePreference('theme', next); applyTheme(); }),
    choice(t('time'), [['system', 'system'], ['12h', 'hour12'], ['24h', 'hour24']], clock, (next) => { clock = next; savePreference('clock', next); }),
    choice(t('wallpaper'), [['default', 'defaultWallpaper'], ['plain', 'plainWallpaper']], wallpaper, chooseWallpaper),
  );
  const legal = el('div', 'feature-toolbar');
  for (const [label, href] of [
    ['privacy', 'https://offlinesms.com/offlinesms-privacy-policy.html'],
    ['terms', 'https://offlinesms.com/offlinesms-terms-of-service.html'],
  ]) {
    const link = el('a', '', t(label));
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    legal.append(link);
  }
  content.append(legal);
  featurePanel.replaceChildren(content);
}

function renderSection() {
  if (section === 'settings') showSettings();
  else feeds.render(section);
}

function navigate(next) {
  tools.dismiss();
  closeDialog();
  if (section !== next) { feeds.stop(); featurePanel.scrollTop = 0; }
  section = next;
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
  } else renderSection();
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

const feeds = createLiveFeeds({ panel: featurePanel, getLanguage: () => language, call, formatTime });
const signIn = createSignInView({
  container: byId('web-sign-in'), getLanguage: () => language, setLanguage,
  requestCode: (email) => client.requestEmailOtp(email),
  verifyCode: (email, code) => client.verifyEmailOtp(email, code),
  getPhoneAvailability: () => client.getPhoneAvailability(),
  requestPhoneCode: (phone, options) => client.requestPhoneCode(phone, options),
  verifyPhoneCode: (challengeId, code, options) => client.verifyPhoneCode(challengeId, code, options),
  resetPhoneFlow: () => client?.resetPhoneFlow(),
  phoneErrorInfo: (error) => client.phoneErrorInfo(error),
  signOut: () => client.signOut(),
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
  getMessageInfo: (item) => chatMessageAction('getMessageInfo', item),
  forwardMessage: (id, item) => item.conversationId === activeId ? call('forwardMessages', {
    sourceConversationId: item.conversationId, messageIds: [item.id], targetConversationIds: [id],
  }) : Promise.reject(new Error('Conversation required')),
});

function showComposerOptions() {
  const grid = el('div', 'emoji-grid');
  for (const emoji of ['😊', '😂', '❤️', '👍', '🎉', '🙏', '👋', '🤔', '🙌', '✅', '☕', '⭐']) {
    grid.append(button(emoji, () => {
      closeDialog();
      messageInput.setRangeText(emoji, messageInput.selectionStart, messageInput.selectionEnd, 'end');
      drafts.set(activeId, messageInput.value);
      updateComposer();
      messageInput.focus();
    }, 'feature-button'));
  }
  showDialog(t('composerOptions'), grid);
}

async function send(event) {
  event.preventDefault();
  const text = messageInput.value.trim();
  const id = activeId;
  const replyTo = replies.get(id) || null;
  if (!id || !text || !currentThread || sends.get(id)?.busy || sendingRestricted()) return;
  const generation = session;
  const previous = sends.get(id);
  const attempt = previous?.text === text && previous?.replyTo?.messageId === replyTo?.messageId
    ? previous : { text, replyTo, localId: crypto.randomUUID() };
  sends.set(id, attempt);
  attempt.busy = true;
  attempt.error = false;
  updateComposer();
  try {
    await client.sendText({ conversationId: id, text, replyTo, localId: attempt.localId });
    if (generation !== session) return;
    sends.delete(id);
    drafts.delete(id);
    replies.delete(id);
    if (activeId === id) {
      messageInput.value = '';
      renderReply();
      messageInput.focus();
    }
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
  ++session;
  ++threadGeneration;
  stopList?.();
  stopThread?.();
  for (const stop of stopStates.values()) stop();
  stopList = stopThread = undefined;
  stopStates.clear();
  profiles.clear();
  userStates.clear();
  drafts.clear();
  replies.clear();
  sends.clear();
  conversations = [];
  listState = 'loading';
  activeId = currentThread = pendingRead = undefined;
  renderedThread = undefined;
  threadError = false;
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
    if (!profile || profile.status !== 'active') {
      workspace.hidden = true;
      clearSession();
      user = undefined;
      signIn.showBlocked();
      return;
    }
    if (user?.uid === next.uid) return;
    user = next;
    signIn.hide();
    filter = 'all';
    navigate('chats');
    workspace.hidden = false;
    subscribeList();
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
byId('details').addEventListener('click', showDetails);
byId('conversation-search').addEventListener('click', showMessageSearch);
byId('wallpaper').addEventListener('click', () => showDialog(t('wallpaper'),
  choice(t('wallpaper'), [['default', 'defaultWallpaper'], ['plain', 'plainWallpaper']], wallpaper, chooseWallpaper)));
byId('extras').addEventListener('click', showComposerOptions);
byId('back').addEventListener('click', () => {
  workspace.dataset.mobileView = 'list';
  [...list.querySelectorAll('[data-thread]')].find((item) => item.dataset.thread === activeId)?.focus({ preventScroll: true });
});
latest.addEventListener('click', () => { scroll.scrollTop = scroll.scrollHeight; scroll.focus({ preventScroll: true }); });
scroll.addEventListener('scroll', updateLatest, { passive: true });
messageInput.addEventListener('input', () => { drafts.set(activeId, messageInput.value); updateComposer(); });
messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    if (!byId('send').disabled) composer.requestSubmit();
  }
});
composer.addEventListener('submit', send);
document.addEventListener('visibilitychange', maybeMarkRead);
window.addEventListener('focus', maybeMarkRead);
darkMode.addEventListener('change', applyTheme);
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) { stopAccount?.(); unsubscribeAuth?.(); }
});
dialog.addEventListener('close', () => {
  if (!dialog.open) byId('dialog-content').replaceChildren();
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
