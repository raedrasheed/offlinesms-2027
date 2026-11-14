import { locationUrl, parseContact, parseLocation } from '../mobile/src/media/attachmentModel.ts';
import { sanitizePoll, toggleSelection } from '../mobile/src/lib/pollModel.ts';

const labels = {
  ar: {
    location: 'الموقع', openMap: 'فتح في الخرائط', contact: 'جهة اتصال',
    poll: 'استطلاع رأي', anonymous: 'تصويت مجهول', public: 'تصويت علني', closed: 'انتهى التصويت',
    one: 'اختر إجابة واحدة', many: 'اختر إجابة واحدة أو أكثر', vote: 'إرسال التصويت', clear: 'إلغاء تصويتي',
    voters: 'المصوّتون', votes: 'الأصوات', load: 'جارٍ تحميل تصويتك…',
    loadFailed: 'تعذّر تحميل تصويتك.', retry: 'إعادة المحاولة',
    voteFailed: 'تعذّر حفظ التصويت. حاول مرة أخرى.',
    end: 'إنهاء الاستطلاع', endConfirm: 'تأكيد الإنهاء', cancel: 'إلغاء', endFailed: 'تعذّر إنهاء الاستطلاع.',
  },
  en: {
    location: 'Location', openMap: 'Open in Maps', contact: 'Contact',
    poll: 'Poll', anonymous: 'Anonymous poll', public: 'Public poll', closed: 'Poll closed',
    one: 'Select one option', many: 'Select one or more options', vote: 'Submit vote', clear: 'Remove my vote',
    voters: 'Voters', votes: 'Votes', load: 'Loading your vote…',
    loadFailed: 'Could not load your vote.', retry: 'Retry',
    voteFailed: 'Could not save your vote. Try again.',
    end: 'End poll', endConfirm: 'Confirm end', cancel: 'Cancel', endFailed: 'Could not end the poll.',
  },
};

const paths = {
  location: 'M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Zm-5 0a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z',
  contact: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2',
};

function element(tag, className, value = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}

function button(className, label, onClick) {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function card(kind, title) {
  const root = element('div', `chat-rich-message chat-rich-${kind}`);
  const top = element('div', 'chat-rich-header');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[kind]);
  icon.append(path);
  const heading = element('strong', 'chat-rich-title', title);
  heading.dir = 'auto';
  top.append(icon, heading);
  root.append(top);
  return root;
}

function locationCard(location, text) {
  const root = card('location', location.label || text.location);
  const link = element('a', 'chat-rich-link', text.openMap);
  link.href = locationUrl(location);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  root.append(link);
  return root;
}

function contactCard(contact, text) {
  const root = card('contact', contact.name);
  const lines = contact.uid ? [contact.username ? `OfflineSMS · @${contact.username}` : 'OfflineSMS']
    : [...contact.phones, ...contact.emails];
  const details = element('ul', 'chat-rich-contact-fields');
  details.setAttribute('aria-label', text.contact);
  for (const value of lines) {
    const field = element('li', '', value);
    field.dir = 'ltr';
    details.append(field);
  }
  root.append(details);
  return root;
}

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function pollCard(source, text, context) {
  const { locale, uid, canVote, votePoll, getBallot, closePoll, isActive } = context;
  if (!Array.isArray(source.options)) return null;
  const legacy = source.options.some((option) => typeof option === 'string');
  const poll = sanitizePoll(legacy ? { ...source, options: source.options.map((option, index) => ({
    id: `o${index + 1}`, text: typeof option === 'string' ? option : option?.text,
  })) } : source);
  const options = poll.options.filter(({ text }) => text.trim());
  if (!options.length) return null;

  const number = new Intl.NumberFormat(locale);
  const root = element('div', 'chat-rich-message chat-rich-poll');
  const question = element('strong', 'chat-rich-title', poll.question || text.poll);
  question.dir = 'auto';
  const mode = element('p', 'chat-rich-hint');
  const optionsList = element('div', 'chat-rich-poll-options');
  optionsList.setAttribute('role', 'group');
  optionsList.setAttribute('aria-label', poll.question || text.poll);
  const status = element('p', 'chat-rich-hint chat-rich-poll-status');
  status.setAttribute('role', 'status');
  const voters = element('p', 'chat-rich-hint chat-rich-poll-voters');
  const controls = element('div', 'chat-rich-poll-actions');
  root.append(question, mode, optionsList, voters, controls, status);

  const active = () => root.isConnected && isActive();
  const normalize = (values) => options.filter(({ id }) => Array.isArray(values) && values.includes(id)).map(({ id }) => id);
  let ballot = poll.anonymous ? [] : normalize(Object.hasOwn(poll.votes, uid) ? poll.votes[uid] : []);
  let selected = ballot;
  let seq = 0;
  let known = !poll.anonymous;
  let count = poll.voterCount;
  let counts = poll.counts;
  let closed = poll.closed;
  let busy = false;
  let confirmClose = false;
  const canInteract = Boolean(canVote && votePoll && !legacy);
  const canLoadBallot = Boolean(canVote && poll.anonymous && getBallot && !legacy);

  const rows = options.map(({ id, text: label }) => {
    const caption = element('span', 'chat-rich-poll-option-label', label);
    caption.dir = 'auto';
    const tally = element('span', 'chat-rich-poll-option-count');
    const track = element('span', 'chat-rich-poll-track');
    const bar = element('span', 'chat-rich-poll-bar');
    track.setAttribute('aria-hidden', 'true');
    track.append(bar);
    const option = button('chat-rich-poll-option', '', () => {
      if (!active() || !canInteract || !known || closed || busy) return;
      const next = toggleSelection(poll, selected, id);
      if (poll.multiple) { selected = next; display(); }
      else void submit(next);
    });
    option.dataset.optionId = id;
    option.append(caption, tally, track);
    optionsList.append(option);
    return { id, label, option, tally, bar };
  });

  const submitVote = button('feature-button chat-rich-poll-submit', text.vote, () => void submit(selected));
  const clearVote = button('feature-button chat-rich-poll-clear', text.clear, () => void submit([]));
  const retry = button('feature-button chat-rich-poll-retry', text.retry, () => void loadBallot());
  const end = button('feature-button chat-rich-poll-end', text.end, () => { confirmClose = true; display(); });
  const confirm = button('feature-button chat-rich-poll-confirm', text.endConfirm, () => void endPoll());
  const cancel = button('feature-button chat-rich-poll-cancel', text.cancel, () => { confirmClose = false; display(); });
  controls.append(submitVote, clearVote, retry, end, confirm, cancel);

  function display() {
    const interactive = canInteract && !closed;
    mode.textContent = [poll.anonymous ? text.anonymous : text.public,
      closed ? text.closed : interactive ? (poll.multiple ? text.many : text.one) : ''].filter(Boolean).join(' · ');
    const voteDisabled = !interactive || !known || busy || confirmClose;
    for (const { id, label, option, tally, bar } of rows) {
      const n = validCount(counts?.[id]);
      const value = number.format(n);
      option.disabled = voteDisabled;
      option.setAttribute('aria-pressed', String(selected.includes(id)));
      option.setAttribute('aria-label', `${label}, ${text.votes} ${value}`);
      tally.textContent = value;
      bar.style.inlineSize = `${count ? Math.min(100, Math.round(n * 100 / count)) : 0}%`;
    }
    voters.textContent = `${text.voters} · ${number.format(count)}`;
    submitVote.hidden = !interactive || !poll.multiple || !known || confirmClose;
    submitVote.disabled = busy || selected.join() === ballot.join();
    clearVote.hidden = !interactive || !ballot.length || confirmClose;
    clearVote.disabled = busy;
    retry.hidden = !canLoadBallot || known || confirmClose;
    retry.disabled = busy;
    const mayEnd = Boolean(closePoll && canInteract && uid === (context.senderUid ?? '') && !closed);
    end.hidden = !mayEnd || confirmClose;
    confirm.hidden = cancel.hidden = !mayEnd || !confirmClose;
    end.disabled = confirm.disabled = cancel.disabled = busy;
    status.hidden = !status.textContent;
  }

  async function loadBallot() {
    if (!active() || !canLoadBallot || busy) return;
    busy = true;
    status.textContent = text.load;
    display();
    try {
      const saved = await getBallot();
      if (!active()) return;
      ballot = selected = normalize(saved?.optionIds);
      seq = validCount(saved?.seq);
      known = true;
      status.textContent = '';
    } catch {
      status.textContent = text.loadFailed;
    } finally {
      busy = false;
      if (active()) display();
    }
  }

  async function submit(next) {
    if (!active() || !canInteract || !known || busy || closed || confirmClose) return;
    busy = true;
    status.textContent = '';
    display();
    try {
      const result = await votePoll(next, seq);
      if (!active()) return;
      ballot = selected = normalize(result?.selection ?? next);
      seq = Math.max(seq, validCount(result?.seq));
      if (Number.isSafeInteger(result?.voterCount) && result.voterCount >= 0) count = result.voterCount;
      if (result?.counts && typeof result.counts === 'object') counts = result.counts;
    } catch {
      status.textContent = text.voteFailed;
    } finally {
      busy = false;
      if (active()) display();
    }
  }

  async function endPoll() {
    if (!active() || !closePoll || busy || !confirmClose) return;
    busy = true;
    status.textContent = '';
    display();
    try { await closePoll(); closed = true; }
    catch { status.textContent = text.endFailed; }
    finally {
      confirmClose = busy = false;
      if (active()) display();
    }
  }

  display();
  if (canLoadBallot) queueMicrotask(loadBallot);
  return root;
}

export function renderRichMessage(item, context) {
  const text = labels[context.locale] ?? labels.en;
  if (item.type === 'location') {
    const location = parseLocation(item.location);
    return location ? locationCard(location, text) : null;
  }
  if (item.type === 'contact') {
    const contact = parseContact(item.contact);
    return contact ? contactCard(contact, text) : null;
  }
  return item.type === 'poll' && item.poll ? pollCard(item.poll, text, {
    ...context, senderUid: item.senderUid ?? item.senderId,
  }) : null;
}
