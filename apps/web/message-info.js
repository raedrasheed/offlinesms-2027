import { avatarColor } from '../mobile/src/lib/avatar.ts';
import { createMessageInfoSms } from './message-info-sms.js';

const copy = {
  en: {
    title: 'Message info', back: 'Back to conversation', options: 'Message info options', refresh: 'Refresh',
    members: 'members', delivered: 'Delivered', read: 'Read', pending: 'Pending', failed: 'Failed', played: 'Played', all: 'All',
    filter: 'Filter recipients', search: 'Search recipients', unnamed: 'Unknown recipient', empty: 'No recipients in this state.',
    permission: 'Only the sender can see individual recipient details.', loading: 'Loading message info…',
    error: 'Could not load message info.', retry: 'Try again', deleted: 'This message was deleted.',
    sms: 'Send via OfflineSMS', smsHint: 'Reach recipients who haven’t read or received this message.',
  },
  ar: {
    title: 'معلومات الرسالة', back: 'العودة إلى المحادثة', options: 'خيارات معلومات الرسالة', refresh: 'تحديث',
    members: 'أعضاء', delivered: 'وصلت', read: 'قُرئت', pending: 'قيد الانتظار', failed: 'فشلت', played: 'شُغّلت', all: 'الكل',
    filter: 'تصفية المستلمين', search: 'ابحث عن مستلم', unnamed: 'مستلم غير معروف', empty: 'لا يوجد مستلمون بهذه الحالة.',
    permission: 'تفاصيل المستلمين متاحة لمرسل الرسالة فقط.', loading: 'جارٍ تحميل معلومات الرسالة…',
    error: 'تعذّر تحميل معلومات الرسالة.', retry: 'إعادة المحاولة', deleted: 'حُذفت هذه الرسالة.',
    sms: 'الإرسال عبر OfflineSMS', smsHint: 'تواصل مع المستلمين الذين لم يقرأوا الرسالة أو لم تصلهم.',
  },
};

const statuses = ['delivered', 'read', 'pending', 'failed'];
const filters = ['all', 'read', 'delivered', 'pending', 'failed'];
const paths = {
  back: 'm15 18-6-6 6-6', options: 'M5 12h.01M12 12h.01M19 12h.01',
  delivered: 'm2 12 5 5 10-10m-6 9 10-10', read: 'm2 12 5 5 10-10m-6 9 10-10', played: 'm2 12 5 5 10-10m-6 9 10-10',
  pending: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 6v6l4 2',
  failed: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 7v5m0 4h.01',
  search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 5 5',
};

function element(tag, className, value = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}

function action(className, value, run) {
  const button = element('button', className, value);
  button.type = 'button';
  button.addEventListener('click', run);
  return button;
}

function icon(kind) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const path = document.createElementNS(ns, 'path');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', paths[kind]);
  if (kind === 'options') path.setAttribute('stroke-width', '3.5');
  svg.append(path);
  return svg;
}

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function receiptBucket(status) {
  if (['read', 'viewed', 'played'].includes(status)) return 'read';
  return statuses.includes(status) ? status : 'pending';
}

export function createMessageInfo({ message, title, memberCount, locale, formatTime, makeAvatar, call, onBack, isActive }) {
  const text = copy[locale] ?? copy.en;
  const number = new Intl.NumberFormat(locale);
  const collator = new Intl.Collator(locale, { sensitivity: 'base' });
  const view = element('div', 'message-info-view');
  const header = element('header', 'message-info-header');
  const back = action('message-info-back', '', () => leaveSms ? leaveSms() : onBack());
  back.setAttribute('aria-label', text.back);
  back.append(icon('back'));
  const heading = element('div', 'message-info-heading');
  const headingTitle = element('h2', '', text.title);
  headingTitle.id = 'message-info-title';
  headingTitle.tabIndex = -1;
  const subtitle = element('p', '', Number.isInteger(memberCount) ? `${title} · ${number.format(memberCount)} ${text.members}` : title);
  subtitle.dir = 'auto';
  heading.append(headingTitle, subtitle);
  const menu = element('details', 'message-info-menu');
  const options = element('summary', 'message-info-options');
  options.setAttribute('aria-label', text.options);
  options.append(icon('options'));
  const refresh = action('feature-button message-info-refresh', text.refresh, () => { menu.open = false; void load(); });
  menu.append(options, refresh);
  header.append(back, heading, menu);

  const content = element('div', 'message-info-content');
  const details = element('div', 'message-info-details');
  const bubble = element('div', 'message-info-bubble');
  const preview = element('p', '', message.text || '—');
  preview.dir = 'auto';
  const time = element('time', '', message.timeLabel);
  time.hidden = !message.timeLabel;
  const activity = element('div', 'message-info-activity');
  bubble.append(preview, time);
  details.append(bubble, activity);
  content.append(details);
  view.append(header, content);

  let request = 0;
  let activeFilter = 'all';
  let query = '';
  let leaveSms;

  function recipientRow(recipient) {
    const name = recipient.displayName || text.unnamed;
    const row = element('li', 'message-info-recipient');
    const avatar = makeAvatar(name, recipient.photoURL);
    avatar.classList.add('message-info-avatar');
    avatar.style.setProperty('--info-avatar-color', avatarColor(recipient.uid ?? name));
    const label = element('div', 'message-info-recipient-copy');
    const recipientName = element('strong', '', name);
    recipientName.dir = 'auto';
    const times = [
      ['delivered', recipient.deliveredAt], ['read', recipient.readAt ?? recipient.viewedAt],
      ['played', recipient.playedAt], ['failed', recipient.failedAt],
    ].flatMap(([status, timestamp]) => {
      const formatted = formatTime(timestamp);
      return formatted ? [`${text[status]} ${formatted}`] : [];
    });
    label.append(recipientName, element('p', '', times.join(' · ') || '—'));
    const status = recipient.status === 'played' ? 'played' : receiptBucket(recipient.status);
    const badge = element('span', 'message-info-badge');
    badge.dataset.status = status;
    if (['delivered', 'read', 'played'].includes(status)) badge.append(icon(status));
    badge.append(text[status]);
    row.append(avatar, label, badge);
    return row;
  }

  function showRecipients(recipients, totals) {
    const filterGroup = element('div', 'message-info-filters');
    filterGroup.setAttribute('role', 'group');
    filterGroup.setAttribute('aria-label', text.filter);
    const filterButtons = filters.map((key) => {
      const button = action('', key === 'all' ? text.all : `${text[key]} ${number.format(totals[key])}`, () => {
        activeFilter = key;
        updateList();
      });
      button.dataset.filter = key;
      return button;
    });
    filterGroup.append(...filterButtons);
    const search = element('label', 'message-info-search');
    const input = element('input', '');
    input.type = 'search';
    input.dir = 'auto';
    input.placeholder = text.search;
    input.value = query;
    input.setAttribute('aria-label', text.search);
    input.autocomplete = 'off';
    input.addEventListener('input', () => { query = input.value; updateList(); });
    search.append(icon('search'), input);
    const list = element('ul', 'message-info-recipients');
    const empty = element('p', 'message-info-note', text.empty);
    empty.setAttribute('role', 'status');
    activity.append(filterGroup, search, list, empty);

    function updateList() {
      for (const button of filterButtons) button.setAttribute('aria-pressed', String(button.dataset.filter === activeFilter));
      const match = query.trim().toLocaleLowerCase(locale);
      const visible = recipients.filter((recipient) =>
        (activeFilter === 'all' || receiptBucket(recipient.status) === activeFilter)
        && (recipient.displayName || text.unnamed).toLocaleLowerCase(locale).includes(match));
      list.replaceChildren(...visible.map(recipientRow));
      empty.hidden = Boolean(visible.length);
    }
    updateList();
  }

  function showSms(trigger) {
    const previousScroll = content.scrollTop;
    let sms;
    leaveSms = () => {
      sms.remove();
      leaveSms = undefined;
      menu.hidden = details.hidden = false;
      headingTitle.textContent = text.title;
      back.setAttribute('aria-label', text.back);
      content.scrollTop = previousScroll;
      trigger.focus({ preventScroll: true });
    };
    sms = createMessageInfoSms({ message, locale, call,
      isActive: () => isActive() && sms?.isConnected, onBusyChange: (busy) => { back.disabled = busy; } });
    menu.open = false;
    menu.hidden = details.hidden = true;
    headingTitle.textContent = text.sms;
    back.setAttribute('aria-label', text.title);
    content.append(sms);
    content.scrollTop = 0;
    headingTitle.focus();
  }

  function showData(data) {
    const a = data.aggregates ?? data.receiptCounts ?? {};
    const sender = data.isSender === true;
    const deleted = data.deletedForEveryone === true;
    const recipients = sender && Array.isArray(data.recipients)
      ? [...data.recipients].sort((a, b) => collator.compare(a.displayName || text.unnamed, b.displayName || text.unnamed)) : null;
    const totals = { delivered: 0, read: 0, pending: 0, failed: 0 };
    for (const recipient of recipients ?? []) totals[receiptBucket(recipient.status)]++;
    // Read/viewed/played are one filter. The delivered total includes recipients who read the message.
    const summary = {
      delivered: count(a.deliveredCount), read: count(a.viewedCount ?? a.readCount) + count(a.playedCount),
      pending: recipients ? totals.pending : count(a.pendingCount), failed: count(a.failedCount),
    };
    preview.textContent = deleted ? text.deleted : message.text || '—';
    time.textContent = formatTime(data.createdAt) || message.timeLabel || '';
    time.hidden = !time.textContent;
    const cards = element('div', 'message-info-stats');
    for (const status of statuses) {
      const card = element('div', 'message-info-stat');
      card.dataset.status = status;
      const value = element('div', 'message-info-stat-value');
      value.append(icon(status), number.format(summary[status]));
      card.append(value, element('div', 'message-info-stat-label', text[status]));
      cards.append(card);
    }
    activity.replaceChildren(cards);
    if (sender && !deleted && (summary.pending > 0 || summary.failed > 0 || summary.delivered > summary.read || totals.delivered > 0)) {
      const sms = action('message-info-sms', '', () => showSms(sms));
      sms.append(element('strong', '', text.sms), element('span', '', text.smsHint));
      activity.append(sms);
    }
    if (recipients) showRecipients(recipients, totals);
    else if (!sender) activity.append(element('p', 'message-info-note', text.permission));
  }

  async function load() {
    const at = ++request;
    refresh.disabled = true;
    const loading = element('p', 'message-info-note', text.loading);
    loading.setAttribute('role', 'status');
    activity.replaceChildren(loading);
    try {
      const data = await call('getMessageInfo', { conversationId: message.conversationId, messageId: message.id });
      if (isActive() && at === request) showData(data);
    } catch {
      if (!isActive() || at !== request) return;
      const error = element('p', 'message-info-note', text.error);
      error.setAttribute('role', 'alert');
      activity.replaceChildren(error, action('feature-button', text.retry, load));
    } finally {
      if (at === request) refresh.disabled = false;
    }
  }

  return { view, load, focus: () => headingTitle.focus() };
}
