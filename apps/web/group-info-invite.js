import { inviteUrl } from '../mobile/src/lib/invite.ts';
import { displayNameFor } from '../mobile/src/lib/displayNames.pure.ts';

const labels = {
  en: {
    inviteLink: 'Invite link', enable: 'Enable invite link', open: 'Anyone can join', approval_required: 'Admin approval',
    copy: 'Copy', share: 'Share', reset: 'Reset', requests: 'Pending requests', requestTitle: 'Join requests',
    approve: 'Approve', reject: 'Reject', unknown: 'Unknown user', empty: 'No pending requests.',
    loading: 'Loading…', settingsFailed: 'Could not load invite settings.', requestsFailed: 'Could not load join requests.',
    updateFailed: 'Could not update the invite link.', decisionFailed: 'Could not complete this request.',
    copied: 'Invite link copied.', copyHint: 'Select and copy this invitation link.',
    resetTitle: 'Reset invite link', resetHint: 'The current link will stop working and a new link will be created.',
    cancel: 'Cancel', resetDone: 'Invite link reset.', shareTitle: 'Join my group on OfflineSMS',
  },
  ar: {
    inviteLink: 'رابط الدعوة', enable: 'تفعيل رابط الدعوة', open: 'يمكن للجميع الانضمام', approval_required: 'موافقة المشرف',
    copy: 'نسخ', share: 'مشاركة', reset: 'إعادة تعيين', requests: 'الطلبات المعلّقة', requestTitle: 'طلبات الانضمام',
    approve: 'قبول', reject: 'رفض', unknown: 'مستخدم غير معروف', empty: 'لا توجد طلبات معلّقة.',
    loading: 'جارٍ التحميل…', settingsFailed: 'تعذّر تحميل إعدادات الدعوة.', requestsFailed: 'تعذّر تحميل طلبات الانضمام.',
    updateFailed: 'تعذّر تحديث رابط الدعوة.', decisionFailed: 'تعذّر إكمال الطلب.',
    copied: 'تم نسخ رابط الدعوة.', copyHint: 'حدّد رابط الدعوة ثم انسخه.',
    resetTitle: 'إعادة تعيين رابط الدعوة', resetHint: 'سيتوقف الرابط الحالي عن العمل وسيُنشأ رابط جديد.',
    cancel: 'إلغاء', resetDone: 'تمت إعادة تعيين رابط الدعوة.', shareTitle: 'انضم إلى مجموعتي على OfflineSMS',
  },
};

const modes = ['open', 'approval_required'];
const codePattern = /^[ABCDEFGHJKMNPQRSTVWXYZ0123456789]{8,40}$/;

function el(tag, className, text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function button(text, className, run) {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', run);
  return node;
}

export function createGroupInfoInvite({
  uid, conversationId, locale, groupName, client, call, isActive, showDialog, closeDialog, formatTime, makeAvatar,
}) {
  const t = labels[locale] ?? labels.en;
  const number = new Intl.NumberFormat(locale);
  const section = el('section', 'group-info-section group-info-invite');
  const toggle = button('', 'group-info-switch', () => updateSettings(!settings?.enabled, settings?.joinMode));
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-label', t.enable);
  const toggleRow = el('div', 'group-info-row group-info-switch-row');
  toggleRow.append(el('span', '', t.enable), toggle);

  const body = el('div', 'group-info-invite-body');
  const modeRow = el('div', 'group-info-modes');
  const modeButtons = modes.map(mode => button(t[mode], '', () => updateSettings(true, mode)));
  modeRow.append(...modeButtons);
  const link = el('a', 'group-info-invite-url');
  link.dir = 'ltr';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  const inviteButtons = el('div', 'group-info-invite-buttons');
  const copyButton = button(t.copy, '', () => copyLink());
  const shareButton = button(t.share, '', () => shareLink());
  const resetButton = button(t.reset, '', () => confirmReset());
  inviteButtons.append(copyButton, shareButton, resetButton);
  body.append(modeRow, link, inviteButtons);

  const requestCount = el('span', 'group-info-count');
  const chevron = el('span', 'group-info-chevron', '›');
  chevron.setAttribute('aria-hidden', 'true');
  const requests = button('', 'group-info-row group-info-requests', showRequests);
  requests.append(el('span', '', t.requests), requestCount, chevron);
  const feedback = el('p', 'group-info-note');
  feedback.setAttribute('role', 'status');
  section.append(el('h3', 'group-info-section-title', t.inviteLink), toggleRow, body, requests, feedback);

  let watching = false;
  let watchVersion = 0;
  let settings;
  let settingsVersion = 0;
  let pending;
  let error = false;
  let requestsError = false;
  let busy = false;
  let feedbackText = '';
  let modal;
  let refreshRequests;
  const stopWatching = [];
  const deciding = new Set();
  const completedRequests = new Set();
  const active = () => watching && isActive();

  function currentLink() {
    return settings?.enabled && codePattern.test(settings.inviteCode ?? '') ? inviteUrl(settings.inviteCode) : '';
  }

  function render() {
    const url = currentLink();
    const disabled = busy || error || settings === undefined;
    toggle.disabled = disabled;
    toggle.setAttribute('aria-checked', String(settings?.enabled === true));
    body.hidden = !settings?.enabled;
    modeButtons.forEach((control, index) => {
      control.disabled = disabled;
      control.setAttribute('aria-pressed', String((settings?.joinMode ?? 'open') === modes[index]));
    });
    link.hidden = !url;
    if (url) link.href = url;
    else link.removeAttribute('href');
    link.textContent = url;
    copyButton.disabled = shareButton.disabled = resetButton.disabled = disabled || !url;
    requests.hidden = !(settings?.enabled && settings.joinMode === 'approval_required') && !pending?.length;
    requestCount.hidden = !pending?.length;
    requestCount.textContent = pending?.length ? number.format(pending.length) : '';
    feedback.textContent = feedbackText || (error ? t.settingsFailed : settings === undefined ? t.loading : '');
    feedback.hidden = !feedback.textContent;
    refreshRequests?.();
  }

  function track(stop) {
    if (typeof stop === 'function') stopWatching.push(stop);
  }

  function start() {
    if (watching) return;
    watching = true;
    const at = ++watchVersion;
    const listening = () => active() && at === watchVersion;
    track(client.watchGroupInviteSettings(uid, conversationId, value => {
      if (!listening()) return;
      settings = value;
      settingsVersion += 1;
      error = false;
      render();
    }, () => {
      if (!listening()) return;
      settings = undefined;
      settingsVersion += 1;
      error = true;
      render();
    }));
    track(client.watchGroupJoinRequests(uid, conversationId, rows => {
      if (!listening()) return;
      pending = rows.filter(row => !completedRequests.has(row.requestId));
      // An authoritative removal allows this account to submit a future request.
      const ids = new Set(rows.map(row => row.requestId));
      for (const id of completedRequests) if (!ids.has(id)) completedRequests.delete(id);
      requestsError = false;
      render();
    }, () => {
      if (!listening()) return;
      pending = undefined;
      requestsError = true;
      render();
    }));
  }

  function stop() {
    watching = false;
    watchVersion += 1;
    settings = pending = undefined;
    error = requestsError = busy = false;
    feedbackText = '';
    deciding.clear();
    completedRequests.clear();
    for (const unsubscribe of stopWatching.splice(0)) unsubscribe();
    if (modal?.isConnected) closeDialog();
    refreshRequests = undefined;
    render();
  }

  async function mutateSettings(name, payload, success = '') {
    if (!active() || busy || error || settings === undefined) return;
    busy = true;
    feedbackText = '';
    const at = settingsVersion;
    const started = watchVersion;
    const current = () => active() && started === watchVersion;
    render();
    try {
      const next = await call(name, { conversationId, ...payload });
      if (!current()) return;
      // A concurrent server snapshot takes precedence over the callable result.
      if (settingsVersion === at) {
        const { inviteCode, enabled, joinMode } = next ?? {};
        if (typeof inviteCode === 'string') settings = {
          inviteCode, enabled: enabled ?? settings?.enabled, joinMode: joinMode ?? settings?.joinMode,
        };
      }
      feedbackText = success;
    } catch {
      if (current()) feedbackText = t.updateFailed;
    } finally {
      if (current()) { busy = false; render(); }
    }
  }

  function updateSettings(enabled, joinMode = 'open') {
    if (!modes.includes(joinMode)) joinMode = 'open';
    if (settings?.enabled === enabled && settings.joinMode === joinMode) return;
    void mutateSettings('createOrUpdateGroupInviteLink', { enabled, joinMode });
  }

  function showManualCopy(url) {
    if (!active() || currentLink() !== url) return;
    const content = el('div', 'chat-tool-stack');
    const input = el('input', 'feature-input');
    input.readOnly = true;
    input.dir = 'ltr';
    input.setAttribute('aria-label', t.inviteLink);
    input.value = url;
    content.append(el('p', 'chat-tool-note', t.copyHint), input);
    modal = content;
    showDialog(t.inviteLink, content);
    input.focus();
    input.select();
  }

  async function copyLink() {
    const url = currentLink();
    if (!active() || !url) return;
    try {
      await navigator.clipboard.writeText(url);
      if (active() && currentLink() === url) { feedbackText = t.copied; render(); }
    } catch { showManualCopy(url); }
  }

  async function shareLink() {
    const url = currentLink();
    if (!active() || !url) return;
    if (typeof navigator.share !== 'function') { showManualCopy(url); return; }
    try {
      await navigator.share({ title: groupName || t.shareTitle, text: t.shareTitle, url });
    } catch (error) {
      if (error?.name !== 'AbortError') showManualCopy(url);
    }
  }

  function confirmReset() {
    const url = currentLink();
    if (!active() || !url) return;
    const content = el('div', 'chat-tool-stack');
    const actions = el('div', 'feature-toolbar');
    actions.append(button(t.cancel, 'feature-button', closeDialog), button(t.reset, 'feature-button feature-primary', () => {
      if (!active() || !content.isConnected) return;
      closeDialog();
      if (currentLink() === url) void mutateSettings('resetGroupInviteLink', {}, t.resetDone);
    }));
    content.append(el('p', 'chat-tool-note', t.resetHint), actions);
    modal = content;
    showDialog(t.resetTitle, content);
  }

  function showRequests() {
    if (!active()) return;
    const content = el('div', 'chat-tool-stack');
    const status = el('p', 'chat-tool-error');
    status.setAttribute('role', 'alert');
    status.hidden = true;
    const list = el('ul', 'dialog-list group-info-request-list');
    content.append(status, list);
    modal = content;

    async function decide(row, approve) {
      if (!active() || !content.isConnected || deciding.has(row.requestId)
        || !pending?.some(item => item.requestId === row.requestId)) return;
      const at = watchVersion;
      const current = () => active() && at === watchVersion;
      deciding.add(row.requestId);
      status.hidden = true;
      draw();
      try {
        await call(approve ? 'approveGroupJoinRequest' : 'rejectGroupJoinRequest', { conversationId, requestId: row.requestId });
        if (current() && pending?.some(item => item.requestId === row.requestId)) {
          // A completed request cannot be decided again while the listener catches up.
          completedRequests.add(row.requestId);
          pending = pending.filter(item => item.requestId !== row.requestId);
          render();
        }
      } catch {
        if (current() && content.isConnected) { status.textContent = t.decisionFailed; status.hidden = false; }
      } finally {
        if (current()) {
          deciding.delete(row.requestId);
          draw();
        }
      }
    }

    function draw() {
      if (!content.isConnected) return;
      if (!pending?.length) {
        list.replaceChildren(el('li', 'chat-tool-note', requestsError ? t.requestsFailed : pending ? t.empty : t.loading));
        return;
      }
      list.replaceChildren(...pending.map(row => {
        const name = displayNameFor(null, { uid: row.requesterUid, snapshot: row.requesterName, fallback: t.unknown });
        const entry = el('li', 'dialog-item group-info-request-item');
        const info = el('span', 'group-info-request-name', name);
        info.dir = 'auto';
        const time = formatTime?.(row.requestedAt);
        if (time) info.append(el('time', 'chat-tool-note', time));
        const actions = el('span', 'group-info-request-actions');
        const reject = button(t.reject, 'feature-button', () => decide(row, false));
        const approve = button(t.approve, 'feature-button feature-primary', () => decide(row, true));
        approve.disabled = reject.disabled = deciding.has(row.requestId);
        actions.append(reject, approve);
        entry.append(makeAvatar(name, row.requesterPhotoURL), info, actions);
        return entry;
      }));
    }

    refreshRequests = draw;
    showDialog(t.requestTitle, content);
    draw();
  }

  render();
  return { section, start, stop };
}
