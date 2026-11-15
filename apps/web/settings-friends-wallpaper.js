import { normalizePhoneToE164 } from '../mobile/src/lib/phone.ts';

const copy = {
  ar: {
    friends: 'العثور على الأصدقاء', contacts: 'مزامنة جهات الاتصال', username: 'اسم المستخدم', search: 'بحث',
    contactNote: 'اختر جهات الاتصال التي تريد البحث عنها في OfflineSMS.',
    contactUnavailable: 'مزامنة جهات الاتصال تتطلب متصفحًا يدعم اختيارها. يمكنك البحث باسم المستخدم هنا.',
    noContactNumbers: 'لم تُحدّد جهات اتصال بأرقام هواتف صالحة.',
    noContacts: 'لم يُعثر على أي من جهات الاتصال المحددة في OfflineSMS.',
    noUser: 'لم يُعثر على اسم المستخدم.', usernameInvalid: 'أدخل اسم مستخدم صالحًا.',
    loading: 'جارٍ البحث…', openChat: 'فتح المحادثة', failed: 'تعذّر إكمال الطلب. حاول مرة أخرى.',
    progress: (scanned, total) => 'تم التحقق من ' + scanned + ' من ' + total,
    wallpaper: 'خلفية المحادثة', choose: 'اختر من المعرض', default: 'استخدام خلفية التطبيق',
    plain: 'خلفية سادة', hello: 'مرحبًا 👋', reply: 'تبدو جميلة!',
    imageInvalid: 'اختر صورة JPEG أو PNG أو WebP بحجم 20 ميغابايت أو أقل.',
    imageFailed: 'تعذّر حفظ الخلفية على هذا المتصفح.',
  },
  en: {
    friends: 'Find friends', contacts: 'Sync contacts', username: 'Username', search: 'Search',
    contactNote: 'Choose the contacts you want to look up on OfflineSMS.',
    contactUnavailable: 'Contact sync requires a browser with a contact picker. You can search by username here.',
    noContactNumbers: 'No contacts with valid phone numbers were selected.',
    noContacts: 'None of the selected contacts were found on OfflineSMS.',
    noUser: 'No matching username was found.', usernameInvalid: 'Enter a valid username.',
    loading: 'Searching…', openChat: 'Open conversation', failed: 'Could not complete the action. Try again.',
    progress: (scanned, total) => 'Checked ' + scanned + ' of ' + total,
    wallpaper: 'Chat wallpaper', choose: 'Choose from gallery', default: 'Use default wallpaper',
    plain: 'Plain background', hello: 'Hello 👋', reply: 'Looking good!',
    imageInvalid: 'Choose a JPEG, PNG, or WebP image up to 20 MB.',
    imageFailed: 'Could not save the wallpaper in this browser.',
  },
};

const batchSize = 300;
const maxSourceBytes = 20 * 1024 * 1024;
const maxWallpaperChars = 2 * 1024 * 1024;
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];

function element(tag, className, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function status() {
  const node = element('p', 'dialog-note settings-action-note');
  node.setAttribute('role', 'status');
  return node;
}

function action(text, onClick) {
  const button = element('button', 'feature-button', text);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

export function selectedContactPhones(contacts) {
  return [...new Set(contacts.flatMap(contact => (contact.tel ?? [])
    .map(phone => normalizePhoneToE164(phone, '+970')).filter(Boolean)))];
}

export function openWebFindFriends({
  locale, client, user, showDialog, closeDialog, isActive, openDirect, title, includeContacts = true,
}) {
  if (!isActive()) return;
  const text = copy[locale] ?? copy.en;
  const content = element('div', 'feature-form settings-friends-dialog');
  const active = () => isActive() && content.isConnected && content.closest('dialog')?.open;
  let opening = false;

  function resultRow(profile, feedback) {
    const name = profile.displayName || (profile.username && '@' + profile.username);
    if (!name || !profile.uid || profile.uid === user.uid) return null;
    const item = element('div', 'settings-friend');
    const identity = element('div', 'settings-friend-name');
    const label = element('strong', '', name);
    label.dir = 'auto';
    identity.append(label);
    if (profile.displayName && profile.username) identity.append(element('bdi', 'dialog-note', '@' + profile.username));
    const open = action(text.openChat, async () => {
      if (!active() || !item.isConnected || opening) return;
      opening = true;
      open.disabled = true;
      feedback.textContent = '';
      try {
        const result = await client.call('getOrCreateDirectConversation', { otherUserId: profile.uid });
        if (!active()) return;
        if (typeof result?.conversationId !== 'string' || !result.conversationId) throw new Error('conversation-unavailable');
        closeDialog();
        openDirect(result.conversationId, profile);
      } catch {
        if (active()) feedback.textContent = text.failed;
      } finally {
        opening = false;
        open.disabled = false;
      }
    });
    item.append(identity, open);
    return item;
  }

  if (includeContacts) {
    const picker = navigator.contacts;
    const contactSearch = element('section', 'feature-form settings-friend-contacts');
    const results = element('div', 'feature-form');
    const feedback = status();
    const progress = element('progress', 'settings-contact-progress');
    progress.hidden = true;
    progress.setAttribute('aria-label', text.contacts);
    if (typeof picker?.select === 'function') {
      const sync = action(text.contacts, async () => {
        if (!active()) return;
        results.replaceChildren();
        feedback.textContent = '';
        sync.disabled = true;
        try {
          const selected = await picker.select(['tel'], { multiple: true });
          if (!active() || !selected.length) return;
          const phones = selectedContactPhones(selected);
          if (!phones.length) { feedback.textContent = text.noContactNumbers; return; }
          const matches = new Set();
          progress.max = phones.length;
          progress.value = 0;
          progress.hidden = false;
          feedback.textContent = text.loading;
          for (let offset = 0; offset < phones.length && active(); offset += batchSize) {
            const end = Math.min(offset + batchSize, phones.length);
            const result = await client.call('matchContacts', { phones: phones.slice(offset, end), saveMatches: true });
            if (!active()) return;
            for (const profile of result?.matches ?? []) {
              if (matches.has(profile.uid)) continue;
              const item = resultRow(profile, feedback);
              if (item) { matches.add(profile.uid); results.append(item); }
            }
            progress.value = end;
            feedback.textContent = text.progress(end, phones.length);
          }
          if (active() && !matches.size) feedback.textContent = text.noContacts;
        } catch (error) {
          if (active() && error?.name !== 'AbortError') feedback.textContent = text.failed;
        } finally {
          progress.hidden = true;
          sync.disabled = false;
        }
      });
      contactSearch.append(element('p', 'dialog-note', text.contactNote), sync);
    } else {
      const sync = action(text.contacts);
      sync.disabled = true;
      contactSearch.append(sync, element('p', 'dialog-note', text.contactUnavailable));
    }
    contactSearch.append(progress, feedback, results);
    content.append(contactSearch);
  }

  const form = element('form', 'feature-form');
  const field = element('label', 'feature-field', text.username);
  const input = element('input', 'feature-input');
  input.dir = 'ltr';
  input.type = 'search';
  input.maxLength = 21;
  input.autocomplete = 'off';
  input.setAttribute('autocapitalize', 'none');
  input.spellcheck = false;
  input.placeholder = '@username';
  field.append(input);
  const submit = element('button', 'feature-button feature-primary', text.search);
  submit.type = 'submit';
  const feedback = status();
  const result = element('div', 'feature-form');
  form.append(field, submit, feedback, result);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!active() || submit.disabled) return;
    result.replaceChildren();
    submit.disabled = true;
    feedback.textContent = text.loading;
    try {
      const profile = await client.findByUsername(input.value);
      if (!active()) return;
      const item = profile && resultRow(profile, feedback);
      feedback.textContent = item ? '' : text.noUser;
      if (item) result.append(item);
    } catch (error) {
      if (active()) feedback.textContent = error?.code === 'username-invalid' ? text.usernameInvalid : text.failed;
    } finally {
      submit.disabled = false;
    }
  });
  content.append(form);
  showDialog(title || text.friends, content);
  if (!includeContacts) input.focus();
}

function safeWallpaper(pref, fallback = 'default') {
  const type = typeof pref === 'string' ? pref : pref?.type;
  if (type === 'custom' && typeof pref.url === 'string' && pref.url.length <= maxWallpaperChars
    && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/u.test(pref.url)) return { type, url: pref.url };
  if (type === 'default' || type === 'plain') return { type };
  return { type: fallback === 'plain' ? 'plain' : 'default' };
}

function wallpaperKey(uid) {
  return 'offlinesms-web-wallpaper-user-' + uid;
}

export function readBrowserWallpaper(uid, fallback = 'default') {
  if (uid) {
    try { return safeWallpaper(JSON.parse(localStorage.getItem(wallpaperKey(uid))), fallback); } catch { /* Storage is optional. */ }
  }
  return safeWallpaper(fallback);
}

async function wallpaperData(source) {
  const image = new Image();
  const objectUrl = URL.createObjectURL(source);
  try {
    image.src = objectUrl;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('image-empty');
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pref = safeWallpaper({ type: 'custom', url: canvas.toDataURL('image/jpeg', 0.82) });
    if (pref.type !== 'custom') throw new Error('image-not-supported');
    return pref;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function createSettingsFriendsWallpaper({
  locale, client, user, row, showDialog, closeDialog, isActive, openDirect, wallpaper, applyWallpaper,
}) {
  const text = copy[locale] ?? copy.en;
  let selectedWallpaper = safeWallpaper(wallpaper);
  const openFindFriends = () => openWebFindFriends({
    locale, client, user, showDialog, closeDialog, isActive, openDirect,
  });

  function openWallpaper() {
    if (!isActive()) return;
    const content = element('div', 'feature-form');
    const preview = element('div', 'settings-wallpaper-preview');
    preview.setAttribute('aria-hidden', 'true');
    preview.append(
      element('span', 'settings-preview-incoming', text.hello),
      element('span', 'settings-preview-outgoing', text.reply),
    );
    const feedback = status();
    const controls = element('div', 'feature-toolbar');
    const input = element('input', '');
    input.type = 'file';
    input.accept = imageTypes.join(',');
    input.hidden = true;
    const active = () => isActive() && content.isConnected && content.closest('dialog')?.open;
    const choose = action(text.choose, () => input.click());
    const defaultButton = action(text.default, () => save({ type: 'default' }));
    const plainButton = action(text.plain, () => save({ type: 'plain' }));

    function renderPreview() {
      preview.dataset.wallpaper = selectedWallpaper.type;
      if (selectedWallpaper.type === 'custom') preview.style.setProperty('--custom-chat-wallpaper', 'url("' + selectedWallpaper.url + '")');
      else preview.style.removeProperty('--custom-chat-wallpaper');
      defaultButton.setAttribute('aria-pressed', String(selectedWallpaper.type === 'default'));
      plainButton.setAttribute('aria-pressed', String(selectedWallpaper.type === 'plain'));
    }

    function save(next) {
      if (!active()) return;
      try {
        localStorage.setItem(wallpaperKey(user.uid), JSON.stringify(next));
        selectedWallpaper = next;
        applyWallpaper(next);
        feedback.textContent = '';
        renderPreview();
      } catch {
        feedback.textContent = text.imageFailed;
      }
    }

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (!active() || !file) return;
      if (!imageTypes.includes(file.type) || file.size < 1 || file.size > maxSourceBytes) {
        feedback.textContent = text.imageInvalid;
        return;
      }
      for (const button of controls.children) button.disabled = true;
      try {
        save(await wallpaperData(file));
      } catch {
        if (active()) feedback.textContent = text.imageFailed;
      } finally {
        for (const button of controls.children) button.disabled = false;
      }
    });
    controls.append(choose, defaultButton, plainButton);
    content.append(preview, controls, input, feedback);
    renderPreview();
    showDialog(text.wallpaper, content);
  }

  return {
    friends: row({ label: text.friends, icon: 'findFriends', onClick: openFindFriends }),
    wallpaper: row({ label: text.wallpaper, icon: 'wallpaper', onClick: openWallpaper }),
    openFindFriends,
  };
}
