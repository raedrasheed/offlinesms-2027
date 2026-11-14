import { parseContact, parseLocation } from '../mobile/src/media/attachmentModel.ts';
import { POLL_OPTIONS_MAX, POLL_OPTIONS_MIN, POLL_OPTION_MAX, POLL_QUESTION_MAX, validatePollDraft } from '../mobile/src/lib/pollModel.ts';

const copy = {
  en: {
    location: 'Share location', contact: 'Share contact', poll: 'Create poll', send: 'Send', sending: 'Sending…', loading: 'Loading…',
    sendFailed: 'Could not send. Try again.', position: 'Use current location', locating: 'Finding your location…',
    positionFailed: 'Your location is unavailable. Enter the coordinates manually.',
    latitude: 'Latitude', longitude: 'Longitude', label: 'Place name (optional)',
    invalidLocation: 'Enter latitude between −90 and 90 and longitude between −180 and 180.',
    search: 'Search OfflineSMS contacts', find: 'Search', more: 'Load more', retry: 'Retry',
    contactFailed: 'Could not load contacts. Try again.', noContacts: 'No contacts found.',
    selectContact: 'Choose a contact to share.', changeContact: 'Change contact',
    question: 'Question', option: 'Option', addOption: 'Add option', removeOption: 'Remove option',
    multiple: 'Allow multiple answers', anonymous: 'Anonymous voting',
    pollErrors: { question: 'Enter a question.', tooFew: 'Enter at least two options.', tooMany: 'Enter up to 12 options.',
      duplicate: 'Use a different name for each option.', tooLong: 'Shorten the question or options.' },
  },
  ar: {
    location: 'مشاركة موقع', contact: 'مشاركة جهة اتصال', poll: 'إنشاء استطلاع', send: 'إرسال', sending: 'جارٍ الإرسال…', loading: 'جارٍ التحميل…',
    sendFailed: 'تعذّر الإرسال. حاول مرة أخرى.', position: 'استخدام موقعي الحالي', locating: 'جارٍ تحديد موقعك…',
    positionFailed: 'تعذّر تحديد موقعك. أدخل الإحداثيات يدويًا.',
    latitude: 'خط العرض', longitude: 'خط الطول', label: 'اسم المكان (اختياري)',
    invalidLocation: 'أدخل خط عرض بين ‎−٩٠ و٩٠ وخط طول بين ‎−١٨٠ و١٨٠.',
    search: 'ابحث في جهات اتصال OfflineSMS', find: 'بحث', more: 'تحميل المزيد', retry: 'إعادة المحاولة',
    contactFailed: 'تعذّر تحميل جهات الاتصال. حاول مرة أخرى.', noContacts: 'لم يُعثر على جهات اتصال.',
    selectContact: 'اختر جهة اتصال لمشاركتها.', changeContact: 'تغيير جهة الاتصال',
    question: 'السؤال', option: 'الخيار', addOption: 'إضافة خيار', removeOption: 'إزالة الخيار',
    multiple: 'السماح بإجابات متعددة', anonymous: 'تصويت مجهول',
    pollErrors: { question: 'أدخل سؤالًا.', tooFew: 'أدخل خيارين على الأقل.', tooMany: 'أدخل ١٢ خيارًا كحد أقصى.',
      duplicate: 'استخدم نصًا مختلفًا لكل خيار.', tooLong: 'اختصر السؤال أو الخيارات.' },
  },
};

function element(tag, className, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function button(label, action, run) {
  const node = element('button', 'feature-button', label);
  node.type = 'button';
  node.dataset.action = action;
  node.addEventListener('click', run);
  return node;
}

function field(name, label, maxLength, tag = 'input') {
  const wrap = element('label', 'feature-field', label);
  const input = element(tag, 'feature-input');
  input.name = name;
  input.dir = 'auto';
  input.maxLength = maxLength;
  wrap.append(input);
  return { wrap, input };
}

function checkbox(name, label) {
  const wrap = element('label', 'chat-structured-check');
  const input = element('input', '');
  input.type = 'checkbox';
  input.name = name;
  wrap.append(input, label);
  return { wrap, input };
}

function coordinate(value) {
  const latin = value.trim().replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code - (code < 0x06f0 ? 0x0660 : 0x06f0));
  }).replace(/٫/g, '.').replace(/−/g, '-');
  return /^[+-]?(?:\d+(?:[.]\d*)?|[.]\d+)$/.test(latin) ? Number(latin) : NaN;
}

function locationFields(body, text, isActive, feedback) {
  const label = field('label', text.label, 160);
  const latitude = field('latitude', text.latitude, 22);
  const longitude = field('longitude', text.longitude, 22);
  const coordinates = element('div', 'chat-structured-coordinates');
  for (const input of [latitude.input, longitude.input]) {
    input.dir = 'ltr';
    input.inputMode = 'decimal';
  }
  coordinates.append(latitude.wrap, longitude.wrap);
  let position;
  let request = 0;
  let locating = false;
  function finish() {
    locating = false;
    locate.disabled = false;
    locate.textContent = text.position;
  }
  const locate = button(text.position, 'locate', () => {
    if (!isActive() || locating) return;
    if (!navigator.geolocation) { feedback(text.positionFailed); return; }
    const ordinal = ++request;
    locating = locate.disabled = true;
    locate.textContent = text.locating;
    feedback('');
    const fail = () => {
      if (!isActive() || ordinal !== request) return;
      finish();
      feedback(text.positionFailed);
    };
    try {
      navigator.geolocation.getCurrentPosition(({ coords, timestamp }) => {
        if (!isActive() || ordinal !== request) return;
        position = parseLocation({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, capturedAt: timestamp });
        if (!position) { fail(); return; }
        latitude.input.value = String(position.latitude);
        longitude.input.value = String(position.longitude);
        finish();
      }, fail, { timeout: 15000 });
    } catch { fail(); }
  });
  coordinates.addEventListener('input', () => {
    ++request;
    position = undefined;
    finish();
  });
  body.append(locate, label.wrap, coordinates);
  return () => {
    if (locating) return { error: text.locating };
    const lat = coordinate(latitude.input.value);
    const lng = coordinate(longitude.input.value);
    const fix = position?.latitude === lat && position.longitude === lng ? position : undefined;
    const location = parseLocation({ ...fix, latitude: lat, longitude: lng, label: label.input.value });
    return location ? { rich: { kind: 'location', location } } : { error: text.invalidLocation };
  };
}

function contactFields(body, text, locale, call, isActive) {
  const picker = element('div', 'chat-structured-fields');
  const search = field('contactSearch', text.search, 80);
  search.input.type = 'search';
  search.input.autocomplete = 'off';
  const list = element('ul', 'chat-structured-contacts');
  const status = element('p', 'chat-structured-notice');
  status.setAttribute('role', 'status');
  const selectedView = element('div', 'chat-structured-fields');
  selectedView.hidden = true;
  let selected;
  let contacts = new Map();
  let page;
  let term = '';
  let busy = false;
  let generation = 0;

  const find = button(text.find, 'search-contacts', () => { void searchContacts(); });
  const more = button(text.more, 'more-contacts', () => { void loadContacts(generation, page?.cursor); });
  const retry = button(text.retry, 'retry-contacts', () => { void loadContacts(generation, page?.cursor); });
  more.hidden = retry.hidden = true;

  function showSelection(contact) {
    selected = contact;
    picker.hidden = true;
    selectedView.hidden = false;
    const change = button(text.changeContact, 'change-contact', () => {
      selected = undefined;
      selectedView.hidden = true;
      selectedView.replaceChildren();
      picker.hidden = false;
      search.input.focus();
    });
    selectedView.replaceChildren(contactIdentity(contact), change);
    change.focus();
  }

  function renderContacts() {
    const sorted = [...contacts.values()].sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: 'base' }));
    list.replaceChildren(...sorted.map((contact) => {
      const item = element('li', '');
      const pick = button('', 'select-contact', () => showSelection(contact));
      pick.classList.add('chat-structured-contact');
      pick.append(contactIdentity(contact));
      item.append(pick);
      return item;
    }));
  }

  async function loadContacts(ordinal, cursor) {
    if (!isActive() || busy) return;
    busy = true;
    status.textContent = text.loading;
    more.hidden = retry.hidden = true;
    try {
      const result = await call('listAppContacts', { search: term, ...(cursor ? { cursor } : {}) });
      if (!isActive() || ordinal !== generation) return;
      if (result?.schemaVersion !== 2 || !Array.isArray(result.contacts) || !Array.isArray(result.page?.cursor)) {
        throw new Error('invalid-contact-page');
      }
      if (result.page.hasMore && cursor && JSON.stringify(result.page.cursor) === JSON.stringify(cursor)) {
        throw new Error('contact-page-not-advancing');
      }
      for (const item of result.contacts) {
        const contact = parseContact(item);
        if (contact?.uid) contacts.set(contact.uid, contact);
      }
      page = result.page;
      renderContacts();
      status.textContent = contacts.size || page.hasMore ? '' : text.noContacts;
      more.hidden = !page.hasMore;
    } catch {
      if (!isActive() || ordinal !== generation) return;
      status.textContent = text.contactFailed;
      retry.hidden = false;
    } finally {
      if (ordinal === generation) busy = false;
    }
  }

  function searchContacts() {
    if (!isActive()) return;
    term = search.input.value.trim().slice(0, 80);
    contacts = new Map();
    page = undefined;
    busy = false;
    list.replaceChildren();
    return loadContacts(++generation);
  }

  search.input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    void searchContacts();
  });
  picker.append(search.wrap, find, list, status, more, retry);
  body.append(picker, selectedView);
  queueMicrotask(() => { void searchContacts(); });
  return () => selected ? { rich: { kind: 'contact', contact: selected } } : { error: text.selectContact };
}

function contactIdentity(contact) {
  const copy = element('span', 'chat-structured-contact-copy');
  const name = element('strong', '', contact.name);
  name.dir = 'auto';
  copy.append(name, element('span', '', contact.username ? `@${contact.username}` : 'OfflineSMS'));
  return copy;
}

function pollFields(body, text, locale) {
  const question = field('question', text.question, POLL_QUESTION_MAX, 'textarea');
  question.input.rows = 2;
  const options = element('div', 'chat-structured-fields');
  const multiple = checkbox('multiple', text.multiple);
  const anonymous = checkbox('anonymous', text.anonymous);
  const format = new Intl.NumberFormat(locale);
  const add = button(text.addOption, 'add-option', () => { addOption().focus(); });

  function updateOptions() {
    add.disabled = options.children.length >= POLL_OPTIONS_MAX;
    [...options.children].forEach((row, index) => {
      const label = row.querySelector('label');
      const labelText = `${text.option} ${format.format(index + 1)}`;
      label.firstChild.nodeValue = labelText;
      const remove = row.querySelector('button');
      remove.hidden = options.children.length <= POLL_OPTIONS_MIN;
      remove.setAttribute('aria-label', `${text.removeOption} ${format.format(index + 1)}`);
    });
  }

  function addOption() {
    const row = element('div', 'chat-structured-option');
    const option = field('option', text.option, POLL_OPTION_MAX);
    const remove = button('×', 'remove-option', () => {
      const adjacent = row.nextElementSibling ?? row.previousElementSibling;
      row.remove();
      updateOptions();
      adjacent?.querySelector('input')?.focus();
    });
    row.append(option.wrap, remove);
    options.append(row);
    updateOptions();
    return option.input;
  }

  for (let index = 0; index < POLL_OPTIONS_MIN; index++) addOption();
  body.append(question.wrap, options, add, multiple.wrap, anonymous.wrap);
  return () => {
    const value = question.input.value.replace(/\s+/g, ' ').trim();
    const answers = [...options.querySelectorAll('input')].map((input) => input.value.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const error = validatePollDraft(value, answers);
    return error ? { error: text.pollErrors[error] } : {
      rich: { kind: 'poll', poll: { question: value, options: answers, multiple: multiple.input.checked, anonymous: anonymous.input.checked } },
    };
  };
}

export function openStructuredAttachment(kind, { locale, showDialog, closeDialog, call, sendRich, isActive }) {
  const text = copy[locale] ?? copy.en;
  const form = element('form', 'chat-structured-attachment feature-form');
  form.dataset.kind = kind;
  form.noValidate = true;
  const body = element('fieldset', 'chat-structured-fields');
  const status = element('p', 'chat-structured-notice');
  status.setAttribute('role', 'status');
  status.hidden = true;
  const submit = element('button', 'feature-button feature-primary', text.send);
  submit.type = 'submit';
  const active = () => form.isConnected && isActive();
  const feedback = (message) => { status.textContent = message; status.hidden = !message; };
  let readDraft;
  if (kind === 'location') readDraft = locationFields(body, text, active, feedback);
  else if (kind === 'contact') readDraft = contactFields(body, text, locale, call, active);
  else if (kind === 'poll') readDraft = pollFields(body, text, locale);
  else return;

  let attempt;
  form.append(body, status, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!active() || submit.disabled) return;
    const { rich, error } = readDraft();
    if (error) { feedback(error); return; }
    const key = JSON.stringify(rich);
    if (key !== attempt?.key) attempt = { key, localId: crypto.randomUUID() };
    submit.disabled = body.disabled = true;
    submit.textContent = text.sending;
    feedback('');
    try {
      await sendRich(rich, attempt.localId);
      if (active()) closeDialog();
    } catch {
      if (active()) feedback(text.sendFailed);
    } finally {
      if (active()) {
        submit.disabled = body.disabled = false;
        submit.textContent = text.send;
      }
    }
  });
  showDialog(text[kind], form);
}
