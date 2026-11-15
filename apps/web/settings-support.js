import { TICKET_CATEGORIES } from './settings-support-client.js';

const copy = {
  ar: {
    help: 'المساعدة والدعم', newTicket: 'تذكرة جديدة', myTickets: 'تذاكري', category: 'الفئة',
    subject: 'الموضوع', details: 'التفاصيل', subjectPlaceholder: 'وصف مختصر للمشكلة',
    detailsPlaceholder: 'يرجى وصف مشكلتك بالتفصيل', submit: 'إرسال التذكرة',
    submitted: 'تم استلام تذكرتك. سنرد عليك قريبًا.', submitError: 'تعذّر إرسال التذكرة. حاول مرة أخرى.',
    requiredSubject: 'يرجى إدخال الموضوع.', requiredDetails: 'يرجى وصف مشكلتك.',
    loading: 'جارٍ تحميل التذاكر…', historyError: 'تعذّر تحميل التذاكر.', retry: 'إعادة المحاولة',
    empty: 'لا توجد تذاكر بعد. اضغط «تذكرة جديدة» للبدء.',
    categories: { billing: 'الفواتير', technical: 'تقني', account: 'الحساب', other: 'أخرى' },
    statuses: { open: 'مفتوحة', pending: 'قيد الانتظار', resolved: 'تم الحل', closed: 'مغلقة' },
    deleteAccount: 'حذف الحساب', deleteDescription: 'إزالة حسابك وبياناتك نهائيًا',
    deleteTitle: 'حذف الحساب؟', deleteMessage: 'سيُحذف حسابك وملفك الشخصي واسم المستخدم ونقاطك نهائيًا.',
    deleteConfirm: 'حذف نهائيًا', deleting: 'جارٍ حذف الحساب…', cancel: 'إلغاء',
    deleteError: 'تعذّر تأكيد حذف الحساب. حاول مرة أخرى.',
  },
  en: {
    help: 'Help & Support', newTicket: 'New ticket', myTickets: 'My tickets', category: 'Category',
    subject: 'Subject', details: 'Details', subjectPlaceholder: 'Brief description of your issue',
    detailsPlaceholder: 'Please describe your issue in detail', submit: 'Submit ticket',
    submitted: 'Your ticket has been received. We’ll get back to you soon.',
    submitError: 'Could not submit ticket. Please try again.',
    requiredSubject: 'Please enter a subject.', requiredDetails: 'Please describe your issue.',
    loading: 'Loading tickets…', historyError: 'Could not load your tickets.', retry: 'Try again',
    empty: 'No tickets yet. Choose “New ticket” to get started.',
    categories: { billing: 'Billing', technical: 'Technical', account: 'Account', other: 'Other' },
    statuses: { open: 'Open', pending: 'Pending', resolved: 'Resolved', closed: 'Closed' },
    deleteAccount: 'Delete account', deleteDescription: 'Permanently remove your account and data',
    deleteTitle: 'Delete account?', deleteMessage: 'Your account, profile, username, and points will be deleted permanently.',
    deleteConfirm: 'Delete permanently', deleting: 'Deleting account…', cancel: 'Cancel',
    deleteError: 'Could not confirm account deletion. Please try again.',
  },
};

function node(tag, css, text) {
  const element = document.createElement(tag);
  if (css) element.className = css;
  if (text) element.textContent = text;
  return element;
}

function button(label, onClick, css = 'feature-button') {
  const control = node('button', css, label);
  control.type = 'button';
  control.addEventListener('click', onClick);
  return control;
}

function field(label, input) {
  const wrapper = node('label', 'feature-field');
  wrapper.append(node('span', '', label), input);
  return wrapper;
}

function supportView({ locale, text, uid, client, isActive }) {
  const content = node('div', 'feature-form');
  const active = () => content.isConnected && isActive();
  const tabs = node('div', 'feature-toolbar');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', text.help);
  const newTab = button(text.newTicket, () => showHistory(false));
  const historyTab = button(text.myTickets, () => showHistory(true));
  tabs.append(newTab, historyTab);
  const feedback = node('p', 'dialog-note');
  feedback.setAttribute('role', 'status');
  feedback.hidden = true;
  const form = node('form', 'feature-form');
  const category = node('select', 'feature-input');
  for (const value of TICKET_CATEGORIES) {
    const option = node('option', '', text.categories[value]);
    option.value = value;
    option.defaultSelected = value === 'other';
    category.append(option);
  }
  const subject = node('input', 'feature-input');
  subject.maxLength = 120;
  subject.placeholder = text.subjectPlaceholder;
  subject.dir = 'auto';
  subject.required = true;
  const details = node('textarea', 'feature-input');
  details.maxLength = 2000;
  details.placeholder = text.detailsPlaceholder;
  details.dir = 'auto';
  details.rows = 5;
  details.required = true;
  const submit = node('button', 'feature-button feature-primary', text.submit);
  submit.type = 'submit';
  form.append(field(text.category, category), field(text.subject, subject), field(text.details, details), submit);
  const history = node('div', 'feature-form');
  history.hidden = true;
  newTab.setAttribute('aria-pressed', 'true');
  historyTab.setAttribute('aria-pressed', 'false');
  content.append(tabs, feedback, form, history);
  const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  let stopHistory;
  let saving = false;

  function report(message) {
    feedback.textContent = message;
    feedback.hidden = !message;
  }

  function displayTickets(tickets) {
    if (!active() || history.hidden) return;
    if (!tickets.length) {
      history.replaceChildren(node('p', 'dialog-note', text.empty));
      return;
    }
    const list = node('ul', 'feature-comments');
    for (const ticket of tickets) {
      const item = node('li');
      const title = node('strong', '', ticket.subject);
      title.dir = 'auto';
      const date = Number.isFinite(ticket.createdAt?.getTime?.()) ? format.format(ticket.createdAt) : '—';
      const categoryLabel = text.categories[ticket.category] ?? ticket.category;
      const status = text.statuses[ticket.status] ?? ticket.status;
      item.append(title, node('p', '', `${status} · ${categoryLabel} · ${date}`));
      list.append(item);
    }
    history.replaceChildren(list);
  }

  function watchHistory() {
    stopHistory?.();
    history.replaceChildren(node('p', 'dialog-note', text.loading));
    const failed = () => {
      if (active() && !history.hidden) {
        const error = node('p', 'dialog-note', text.historyError);
        error.setAttribute('role', 'alert');
        history.replaceChildren(error, button(text.retry, watchHistory));
      }
    };
    try { stopHistory = client.watchSupportTickets(uid, displayTickets, failed); } catch { failed(); }
  }

  function showHistory(selected) {
    if (!active() || selected === !history.hidden) return;
    newTab.setAttribute('aria-pressed', String(!selected));
    historyTab.setAttribute('aria-pressed', String(selected));
    form.hidden = selected;
    history.hidden = !selected;
    if (selected) watchHistory();
    else {
      stopHistory?.();
      stopHistory = undefined;
      history.replaceChildren();
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !active()) return;
    const title = subject.value.trim();
    const description = details.value.trim();
    if (!title || !description) {
      report(title ? text.requiredDetails : text.requiredSubject);
      (title ? details : subject).focus();
      return;
    }
    saving = true;
    report('');
    form.setAttribute('aria-busy', 'true');
    const fields = [category, subject, details, submit];
    fields.forEach(element => { element.disabled = true; });
    try {
      await client.createSupportTicket(uid, { subject: title, description, category: category.value });
      if (!active()) return;
      form.reset();
      report(text.submitted);
      showHistory(true);
    } catch {
      if (active()) report(text.submitError);
    } finally {
      saving = false;
      form.removeAttribute('aria-busy');
      fields.forEach(element => { element.disabled = false; });
    }
  });
  return { content, dispose: () => stopHistory?.() };
}

export function createSettingsSupport({
  locale, client, user, row, showDialog, closeDialog, isActive, announce,
  onAccountDeleted, onAccountDeletionPending = () => {},
}) {
  const text = copy[locale] ?? copy.en;
  const uid = user.uid;
  let disposeHelp;
  let deleting = false;
  let deleted = false;

  function openHelp() {
    if (!isActive()) return;
    disposeHelp?.();
    const view = supportView({ locale, text, uid, client, isActive });
    showDialog(text.help, view.content);
    const dialog = view.content.closest('dialog');
    const observer = new MutationObserver(() => { if (!view.content.isConnected) release(); });
    function release() {
      view.dispose();
      observer.disconnect();
      dialog?.removeEventListener('close', release);
      if (disposeHelp === release) disposeHelp = undefined;
    }
    disposeHelp = release;
    dialog?.addEventListener('close', release, { once: true });
    if (view.content.parentNode) observer.observe(view.content.parentNode, { childList: true });
  }

  function openDelete() {
    if (!isActive() || deleting || deleted) return;
    const content = node('div', 'feature-form');
    const description = node('p', 'dialog-note', text.deleteMessage);
    const status = node('p', 'dialog-note');
    status.setAttribute('role', 'status');
    status.hidden = true;
    const actions = node('div', 'feature-toolbar');
    const cancel = button(text.cancel, closeDialog);
    cancel.autofocus = true;
    const confirm = button(text.deleteConfirm, confirmDelete, 'feature-button settings-danger-action');
    actions.append(cancel, confirm);
    content.append(description, actions, status);
    showDialog(text.deleteTitle, content);

    async function confirmDelete() {
      if (!isActive() || !content.isConnected || deleting || deleted) return;
      deleting = true;
      onAccountDeletionPending(uid, true);
      cancel.disabled = confirm.disabled = true;
      content.setAttribute('aria-busy', 'true');
      status.textContent = text.deleting;
      status.hidden = false;
      let result;
      try {
        result = await client.deleteOwnAccount(uid);
        deleted = true;
      } catch {
        if (content.isConnected) status.textContent = text.deleteError;
        else if (isActive()) announce(text.deleteError);
      } finally {
        deleting = false;
        onAccountDeletionPending(uid, false);
        content.removeAttribute('aria-busy');
        cancel.disabled = confirm.disabled = deleted;
      }
      if (deleted) {
        if (content.isConnected) closeDialog();
        onAccountDeleted(uid, result);
      }
    }
  }

  return {
    help: row({ label: text.help, icon: 'support', onClick: openHelp }),
    deleteAccount: row({ label: text.deleteAccount, description: text.deleteDescription, icon: 'deleteAcct', onClick: openDelete, danger: true }),
    dispose() { disposeHelp?.(); },
  };
}
