const copy = {
  en: { all: 'All', filters: 'Filter reactions', loading: 'Loading…', unknown: 'Unknown user', empty: 'No reactions yet.' },
  ar: { all: 'الكل', filters: 'تصفية التفاعلات', loading: 'جارٍ التحميل…', unknown: 'مستخدم غير معروف', empty: 'لا توجد تفاعلات بعد.' },
};

function element(tag, className, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export function createReactionDetails({ locale, reactions, initialEmoji, resolveProfile, makeAvatar, isActive }) {
  const text = copy[locale] ?? copy.en;
  const number = new Intl.NumberFormat(locale);
  const view = element('div', 'reaction-details');
  const filters = element('div', 'reaction-details-filters');
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', text.filters);
  const list = element('ul', 'reaction-details-list');
  const empty = element('p', 'reaction-details-empty', text.empty);
  empty.setAttribute('role', 'status');
  view.append(filters, list, empty);

  const profiles = new Map();
  let entries = reactions;
  let selected = initialEmoji || '';

  function profileFor(uid) {
    if (!profiles.has(uid)) {
      const entry = {};
      entry.pending = Promise.resolve().then(() => resolveProfile(uid)).catch(() => null).then((profile) => {
        entry.profile = profile;
        entry.pending = null;
        return profile;
      });
      profiles.set(uid, entry);
    }
    return profiles.get(uid);
  }

  function reactionRow(uid, emoji) {
    const row = element('li', 'reaction-details-row');
    const avatar = element('span', 'reaction-details-avatar');
    const name = element('span', 'reaction-details-name');
    name.dir = 'auto';
    row.append(avatar, name, element('span', 'reaction-details-emoji', emoji));
    function showProfile(profile) {
      const displayName = typeof profile?.name === 'string' ? profile.name.trim() : '';
      const label = displayName && displayName !== uid ? displayName : text.unknown;
      name.textContent = label;
      avatar.replaceChildren(makeAvatar(label, profile?.photoURL));
      row.removeAttribute('aria-busy');
    }

    const cached = profiles.get(uid);
    if (cached && !cached.pending) showProfile(cached.profile);
    else {
      name.textContent = text.loading;
      avatar.append(makeAvatar(text.unknown));
      row.setAttribute('aria-busy', 'true');
      queueMicrotask(async () => {
        if (!row.isConnected || !isActive()) return;
        const entry = profileFor(uid);
        const profile = entry.pending ? await entry.pending : entry.profile;
        if (row.isConnected && isActive()) showProfile(profile);
      });
    }
    return row;
  }

  function renderRows(resetScroll = true) {
    const position = resetScroll ? 0 : list.scrollTop;
    const visible = selected ? entries.filter(({ emoji }) => emoji === selected) : entries;
    const rows = visible.flatMap(({ emoji, uids }) => uids.map((uid) => reactionRow(uid, emoji)));
    list.replaceChildren(...rows);
    list.hidden = rows.length === 0;
    empty.hidden = rows.length > 0;
    list.scrollTop = position;
  }

  function setPressed() {
    for (const button of filters.children) button.setAttribute('aria-pressed', String(button.dataset.emoji === selected));
  }

  function update(next) {
    entries = next;
    const resetScroll = Boolean(selected) && !entries.some(({ emoji }) => emoji === selected);
    if (resetScroll) selected = '';
    const focused = filters.contains(document.activeElement) ? document.activeElement.dataset.emoji : undefined;
    filters.hidden = entries.length < 2;
    if (filters.hidden) filters.replaceChildren();
    else {
      const total = entries.reduce((sum, { uids }) => sum + uids.length, 0);
      const choices = [['', text.all, total], ...entries.map(({ emoji, uids }) => [emoji, emoji, uids.length])];
      filters.replaceChildren(...choices.map(([emoji, label, count]) => {
        const button = element('button', 'reaction-details-filter', `${label} ${number.format(count)}`);
        button.type = 'button';
        button.dataset.emoji = emoji;
        button.addEventListener('click', () => {
          if (selected === emoji) return;
          selected = emoji;
          setPressed();
          renderRows();
        });
        return button;
      }));
      setPressed();
      if (focused !== undefined) {
        const restored = [...filters.children].find((button) => button.dataset.emoji === focused) ?? filters.firstElementChild;
        restored.focus({ preventScroll: true });
      }
    }
    renderRows(resetScroll);
  }

  update(reactions);
  return { view, update };
}
