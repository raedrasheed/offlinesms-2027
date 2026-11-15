import { detectMentionQuery, filterMembers } from '../mobile/src/lib/mentions.ts';

const copy = {
  ar: { label: 'الإشارة إلى عضو', loading: 'جارٍ تحميل الأعضاء…', error: 'تعذّر تحميل الأعضاء.', empty: 'لم يُعثر على أعضاء مطابقين.' },
  en: { label: 'Mention a member', loading: 'Loading members…', error: 'Could not load members.', empty: 'No matching members.' },
};
const maxMentions = 50;
const maxSuggestions = 100;
const queryCharacters = /^[\p{L}\p{M}\p{N}_.-]*$/u;
const querySuffix = /^[\p{L}\p{M}\p{N}_.-]*/u;
const wordCharacter = /[\p{L}\p{M}\p{N}_@]/u;

function findTextEdit(before, after, selection) {
  const delta = after.length - before.length;
  if (selection && Number.isInteger(selection.start) && Number.isInteger(selection.end)) {
    let { start, end } = selection;
    if (start === end && delta < 0) {
      if (selection.type?.endsWith('Backward')) start += delta;
      if (selection.type?.endsWith('Forward')) end -= delta;
    }
    if (start >= 0 && end <= before.length && start <= end && end + delta >= start
      && before.slice(0, start) === after.slice(0, start) && before.slice(end) === after.slice(end + delta)) {
      return { start, end, delta };
    }
  }

  let start = 0;
  let end = before.length;
  let newEnd = after.length;
  while (start < end && start < newEnd && before[start] === after[start]) start++;
  while (end > start && newEnd > start && before[end - 1] === after[newEnd - 1]) { end--; newEnd--; }
  // A repeated substring can make the edit's location ambiguous without a
  // browser selection. Only retain mentions outside all possible edit ranges.
  let firstEnd = end;
  while (start > 0 && firstEnd > 0 && newEnd > 0 && before[firstEnd - 1] === after[newEnd - 1]) {
    start--; firstEnd--; newEnd--;
  }
  return { start, end, delta };
}

function isMentionToken(text, { startIndex, endIndex, displayName }) {
  return (startIndex === 0 || /\s/u.test(text[startIndex - 1]))
    && text.slice(startIndex, endIndex) === `@${displayName}`
    && !wordCharacter.test(text[endIndex] ?? '');
}

export function updateMentionSpans(before, after, spans, selection) {
  if (before === after || spans.length === 0) return spans;
  const { start, end, delta } = findTextEdit(before, after, selection);
  return spans.flatMap((span) => {
    if (span.endIndex <= start) return [span];
    if (span.startIndex < end) return [];
    return [{ ...span, startIndex: span.startIndex + delta, endIndex: span.endIndex + delta }];
  }).filter((span) => isMentionToken(after, span));
}

export function memberQuery(text, start, end, mentions = []) {
  if (start !== end || mentions.some((span) => span.startIndex < start && span.endIndex >= start)) return null;
  const query = detectMentionQuery(text, start);
  if (!query || !queryCharacters.test(query.query)) return null;
  const tail = querySuffix.exec(text.slice(start))[0];
  if (text[start + tail.length] === '@') return null;
  return { ...query, end: start + tail.replace(/[.-]+$/u, '').length };
}

function mentionReplacement(text, query, member) {
  const token = `@${member.displayName}`;
  const after = text.slice(query.end);
  const separator = /^[\s.,!?;:،؛؟…)\]}]/u.test(after) ? '' : ' ';
  const value = `${text.slice(0, query.start)}${token}${separator}${after}`;
  const cursor = query.start + token.length + (after.startsWith(' ') ? 1 : separator.length);
  return { value, cursor, span: { userId: member.uid, displayName: member.displayName,
    startIndex: query.start, endIndex: query.start + token.length } };
}

export function createMentionComposer({ input, list, language, requestMembers, onChange }) {
  const owner = input.ownerDocument;
  const menuList = owner.createElement('div');
  const status = owner.createElement('p');
  menuList.id = `${list.id}-list`;
  menuList.setAttribute('role', 'listbox');
  status.className = 'mention-status';
  status.setAttribute('role', 'status');
  list.replaceChildren(menuList, status);
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', menuList.id);

  const drafts = new Map();
  let context = null;
  let popup;
  let dismissed;
  let pendingEdit;

  function close() {
    if (!popup) return;
    popup = undefined;
    list.hidden = true;
    menuList.replaceChildren();
    status.textContent = '';
    input.removeAttribute('aria-activedescendant');
  }

  function syncDraft(edit) {
    const draft = drafts.get(context);
    if (draft && draft.text !== input.value) {
      const selection = edit ?? (pendingEdit?.text === draft.text ? pendingEdit : undefined);
      const spans = updateMentionSpans(draft.text, input.value, draft.spans, selection);
      if (spans.length) drafts.set(context, { text: input.value, spans });
      else drafts.delete(context);
    }
    pendingEdit = undefined;
  }

  function selectOption(index, scroll = false) {
    popup.index = index;
    for (const [position, option] of [...menuList.children].entries()) {
      option.setAttribute('aria-selected', position === index ? 'true' : 'false');
    }
    const option = menuList.children[index];
    input.setAttribute('aria-activedescendant', option.id);
    if (scroll) option.scrollIntoView({ block: 'nearest' });
  }

  function render(query) {
    const locale = language();
    const key = JSON.stringify([query.query, query.start, query.end, input.value, locale, popup.state]);
    if (popup.rendered === key) return;
    popup.rendered = key;
    const text = copy[locale] ?? copy.en;
    list.hidden = false;
    menuList.setAttribute('aria-label', text.label);
    const candidates = popup.state === 'ready' ? filterMembers(popup.members, query.query, maxSuggestions) : [];
    const limit = input.maxLength < 0 ? Infinity : input.maxLength;
    popup.options = candidates.filter((member) => mentionReplacement(input.value, query, member).value.length <= limit);
    const rows = popup.options.map((member, index) => {
      const row = owner.createElement('div');
      row.className = 'mention-option';
      row.id = `${menuList.id}-${index}`;
      row.dataset.mentionIndex = index;
      row.setAttribute('role', 'option');
      const avatar = owner.createElement('span');
      avatar.className = 'mention-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = [...member.displayName][0].toLocaleUpperCase(locale);
      if (/^https:\/\//i.test(member.photoURL ?? '')) {
        const image = owner.createElement('img');
        image.alt = '';
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        image.src = member.photoURL;
        image.addEventListener('error', () => image.remove(), { once: true });
        avatar.append(image);
      }
      const details = owner.createElement('span');
      details.className = 'mention-details';
      const name = owner.createElement('strong');
      name.textContent = member.displayName;
      name.dir = 'auto';
      details.append(name);
      if (member.username) {
        const username = owner.createElement('bdi');
        username.textContent = `@${member.username}`;
        details.append(username);
      }
      row.append(avatar, details);
      return row;
    });
    menuList.replaceChildren(...rows);
    list.scrollTop = 0;
    status.hidden = rows.length > 0;
    menuList.hidden = !status.hidden;
    status.textContent = status.hidden ? '' : text[popup.state] ?? text.empty;
    if (rows.length) selectOption(0);
    else input.removeAttribute('aria-activedescendant');
  }

  function refresh(edit) {
    syncDraft(edit);
    const caret = input.selectionStart;
    const draftText = input.value;
    const query = context && !input.disabled && !input.readOnly && owner.activeElement === input
      ? memberQuery(draftText, caret, input.selectionEnd, drafts.get(context)?.spans) : null;
    if (dismissed && (dismissed.text !== draftText || dismissed.caret !== caret)) dismissed = undefined;
    if (!query || dismissed) { close(); return; }
    if (!popup) {
      const loading = { state: 'loading', options: [] };
      const thread = context;
      popup = loading;
      Promise.resolve().then(() => requestMembers(thread)).then((members) => {
        if (popup !== loading) return;
        loading.members = members.flatMap((member) => {
          const displayName = member.displayName?.trim().slice(0, 80).trimEnd();
          if (!displayName) return [];
          return [{ ...member, displayName, username: member.username?.replace(/^@/u, '') }];
        });
        loading.state = 'ready';
        refresh();
      }).catch(() => {
        if (popup !== loading) return;
        loading.state = 'error';
        refresh();
      });
    }
    render(query);
  }

  function choose(index) {
    const member = popup?.options[index];
    const draft = drafts.get(context);
    const query = memberQuery(input.value, input.selectionStart, input.selectionEnd, draft?.spans);
    if (!member || !query) return;
    const { value, cursor, span } = mentionReplacement(input.value, query, member);
    if (input.maxLength >= 0 && value.length > input.maxLength) return;
    const spans = updateMentionSpans(input.value, value, draft?.spans ?? [], query);
    spans.push(span);
    drafts.set(context, { text: value, spans });
    input.value = value;
    input.setSelectionRange(cursor, cursor);
    close();
    input.focus();
    onChange();
  }

  input.addEventListener('beforeinput', (event) => {
    pendingEdit = { text: input.value, start: input.selectionStart, end: input.selectionEnd, type: event.inputType };
  });
  input.addEventListener('input', () => refresh());
  input.addEventListener('focus', () => refresh());
  input.addEventListener('click', () => refresh());
  input.addEventListener('keyup', () => refresh());
  input.addEventListener('select', () => refresh());
  input.addEventListener('blur', close);
  menuList.addEventListener('mousedown', (event) => event.preventDefault());
  menuList.addEventListener('click', (event) => {
    const option = event.target.closest('[data-mention-index]');
    if (option) choose(Number(option.dataset.mentionIndex));
  });

  return {
    setContext(next) {
      if (context === next) return;
      context = next;
      dismissed = pendingEdit = undefined;
      close();
      if (context) refresh();
    },
    clear(thread) {
      drafts.delete(thread);
      if (context === thread) close();
    },
    reset() {
      drafts.clear();
      context = null;
      dismissed = pendingEdit = undefined;
      close();
    },
    refresh,
    keydown(event) {
      if (!popup || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return false;
      const { key } = event;
      const count = popup.options.length;
      if (key === 'Escape') {
        dismissed = { text: input.value, caret: input.selectionStart };
        close();
      } else if (!event.shiftKey && count && (key === 'ArrowDown' || key === 'ArrowUp')) {
        const step = key === 'ArrowDown' ? 1 : -1;
        selectOption((popup.index + step + count) % count, true);
      } else if (!event.shiftKey && count && (key === 'Enter' || key === 'Tab')) choose(popup.index);
      else if (key !== 'Enter' || event.shiftKey || popup.state !== 'loading') return false;
      event.preventDefault();
      return true;
    },
    mentionsFor(thread, text, participantUids) {
      if (context === thread) syncDraft();
      const draft = drafts.get(thread);
      if (!draft || draft.text.trim() !== text) return [];
      const participants = new Set(participantUids);
      const offset = draft.text.length - draft.text.trimStart().length;
      return draft.spans.filter(({ userId }) => participants.has(userId))
        .map((span) => ({ ...span, startIndex: span.startIndex - offset, endIndex: span.endIndex - offset }))
        .sort((first, second) => first.startIndex - second.startIndex)
        .filter((span) => isMentionToken(text, span))
        .slice(0, maxMentions);
    },
  };
}
