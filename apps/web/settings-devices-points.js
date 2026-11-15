const copy = {
  en: {
    points: 'OfflineSMS Points', pointsSubtitle: 'Balance, reservations, and transaction history', unit: 'pts',
    balance: 'Balance', reserved: 'Reserved', available: 'Available', spent: 'Spent', refunded: 'Refunded',
    reservedHelp: 'Reserved points are temporarily held for SMS batches that are still processing.',
    history: 'Transaction history', noTransactions: 'No transactions yet.', loading: 'Loading…',
    loadError: 'Could not load this information.', back: 'Back', cancel: 'Cancel', confirm: 'Confirm', retry: 'Try again',
    types: { sms_spend: 'SMS spending', reservation: 'Reservation', reservation_release: 'Reservation released',
      refund: 'Refund', purchase: 'Points added', transfer_in: 'Transfer in', transfer_out: 'Transfer out',
      admin_adjustment: 'Admin adjustment', other: 'Adjustment' },
    states: { pending: 'Pending', completed: 'Completed', failed: 'Failed', reversed: 'Reversed', refunded: 'Refunded',
      approved: 'Approved', rejected: 'Rejected', active: 'Active', frozen: 'Frozen', closed: 'Closed',
      sending: 'Sending', accepted: 'Accepted', partial: 'Partial', queued: 'Queued',
      sent: 'Sent', delivered: 'Delivered', undelivered: 'Undelivered', skipped: 'Skipped' },
    filters: { all: 'All', sms: 'SMS', refund: 'Refunds', purchase: 'Added', transfer: 'Transfers', admin: 'Admin' },
    id: 'Transaction ID', type: 'Type', direction: 'Direction', credit: 'Credit', debit: 'Debit', status: 'Status',
    created: 'Created', completed: 'Completed', updated: 'Updated', lastReport: 'Last delivery report',
    note: 'Notes', transferId: 'Transfer ID', counterparty: 'Counterparty', smsSettlement: 'SMS settlement',
    report: 'OfflineSMS Delivery Report', batchId: 'OfflineSMS batch ID', audience: 'Audience', attempt: 'Attempt',
    total: 'Total', delivered: 'Delivered', pending: 'Pending', failed: 'Failed', skipped: 'Skipped', sent: 'Sent',
    noRecipients: 'No recipients in this state.', recipient: 'Recipient', retryFailed: 'Retry failed',
    confirmRetry: 'Retry failed SMS for this batch? This can use OfflineSMS Points.',
    retryAccepted: 'Retry submitted.', request: 'Request points', requests: 'My requests', requestAction: 'Request',
    requestNote: 'Select a package to ask an administrator to assign points.',
    noPackages: 'No points packages are available.', noRequests: 'No requests yet.',
    confirmRequest: 'Ask an administrator to assign this package?', requestSent: 'Request sent for review.',
    alreadyPending: 'You already have a pending request.', transfer: 'Transfer points', username: 'Search by username',
    search: 'Search', noMatches: 'No matching users.', amount: 'Points to transfer', remaining: 'Remaining after transfer',
    continue: 'Continue', confirmTransfer: 'Confirm transfer', transferred: 'Points transferred.',
    unavailableWallet: 'Transfers are unavailable for this wallet.', insufficient: 'Insufficient points.',
    dailyLimit: 'Daily transfer limit reached.', actionError: 'Could not complete this action. Try again.',
    uncertain: 'The result could not be confirmed. Check the activity before trying again.',
    devices: 'Linked devices', devicesEmpty: 'Linked devices aren’t available yet',
    devicesNote: 'A future phase will list devices signed in to this account and let you revoke them.',
    storage: 'On-device storage', storageNote: 'Chats and messages kept in the browser’s temporary cache during this session.',
    chats: 'Chats', messages: 'Messages',
  },
  ar: {
    points: 'نقاط OfflineSMS', pointsSubtitle: 'الرصيد والحجوزات وسجل العمليات', unit: 'نقطة',
    balance: 'الرصيد', reserved: 'المحجوز', available: 'المتاح', spent: 'المنفق', refunded: 'المسترد',
    reservedHelp: 'تُحجز النقاط مؤقتًا لدفعات الرسائل القصيرة التي لا تزال قيد المعالجة.',
    history: 'سجل العمليات', noTransactions: 'لا توجد عمليات بعد.', loading: 'جارٍ التحميل…',
    loadError: 'تعذّر تحميل هذه المعلومات.', back: 'رجوع', cancel: 'إلغاء', confirm: 'تأكيد', retry: 'إعادة المحاولة',
    types: { sms_spend: 'تكلفة SMS', reservation: 'حجز نقاط', reservation_release: 'تحرير الحجز',
      refund: 'استرداد', purchase: 'نقاط مضافة', transfer_in: 'تحويل وارد', transfer_out: 'تحويل صادر',
      admin_adjustment: 'تعديل إداري', other: 'تسوية' },
    states: { pending: 'قيد الانتظار', completed: 'مكتمل', failed: 'فشل', reversed: 'معكوس', refunded: 'تم الاسترداد',
      approved: 'تمت الموافقة', rejected: 'مرفوض', active: 'نشط', frozen: 'مجمّد', closed: 'مغلق',
      sending: 'جارٍ الإرسال', accepted: 'مقبول', partial: 'جزئي', queued: 'في قائمة الانتظار',
      sent: 'مُرسل', delivered: 'تم التسليم', undelivered: 'غير مُسلّم', skipped: 'متخطّى' },
    filters: { all: 'الكل', sms: 'SMS', refund: 'الاستردادات', purchase: 'مضافة', transfer: 'التحويلات', admin: 'إداري' },
    id: 'معرّف العملية', type: 'النوع', direction: 'الاتجاه', credit: 'إضافة', debit: 'خصم', status: 'الحالة',
    created: 'وقت الإنشاء', completed: 'وقت الاكتمال', updated: 'آخر تحديث', lastReport: 'آخر تقرير تسليم',
    note: 'ملاحظات', transferId: 'معرّف التحويل', counterparty: 'الطرف الآخر', smsSettlement: 'تسوية الرسائل القصيرة',
    report: 'تقرير تسليم OfflineSMS', batchId: 'معرّف دفعة OfflineSMS', audience: 'المستلمون', attempt: 'المحاولة',
    total: 'الإجمالي', delivered: 'تم التسليم', pending: 'قيد الانتظار', failed: 'فشل', skipped: 'متخطّى', sent: 'مُرسل',
    noRecipients: 'لا يوجد مستلمون بهذه الحالة.', recipient: 'المستلم', retryFailed: 'إعادة إرسال الرسائل الفاشلة',
    confirmRetry: 'هل تريد إعادة إرسال الرسائل الفاشلة في هذه الدفعة؟ قد يتطلب ذلك نقاط OfflineSMS.',
    retryAccepted: 'أُرسل طلب إعادة المحاولة.', request: 'طلب نقاط', requests: 'طلباتي', requestAction: 'طلب',
    requestNote: 'اختر باقة لطلب تعيين نقاط من المسؤول.',
    noPackages: 'لا توجد باقات نقاط متاحة.', noRequests: 'لا توجد طلبات بعد.',
    confirmRequest: 'هل تريد طلب تعيين هذه الباقة من المسؤول؟', requestSent: 'أُرسل الطلب للمراجعة.',
    alreadyPending: 'لديك طلب قيد المراجعة بالفعل.', transfer: 'تحويل نقاط', username: 'البحث باسم المستخدم',
    search: 'بحث', noMatches: 'لم يُعثر على مستخدمين مطابقين.', amount: 'عدد النقاط للتحويل', remaining: 'المتبقي بعد التحويل',
    continue: 'متابعة', confirmTransfer: 'تأكيد التحويل', transferred: 'تم تحويل النقاط.',
    unavailableWallet: 'التحويل غير متاح لهذه المحفظة.', insufficient: 'رصيد النقاط غير كافٍ.',
    dailyLimit: 'بلغت حد التحويل اليومي.', actionError: 'تعذّر إكمال العملية. حاول مرة أخرى.',
    uncertain: 'تعذّر تأكيد النتيجة. راجع سجل النشاط قبل المحاولة مرة أخرى.',
    devices: 'الأجهزة المرتبطة', devicesEmpty: 'الأجهزة المرتبطة غير متاحة بعد',
    devicesNote: 'ستجد هنا الأجهزة التي سجلت الدخول إلى هذا الحساب مع خيار إلغاء ارتباطها عند توفر الميزة.',
    storage: 'التخزين على الجهاز', storageNote: 'المحادثات والرسائل المحفوظة مؤقتًا في ذاكرة المتصفح لهذه الجلسة.',
    chats: 'المحادثات', messages: 'الرسائل',
  },
};

const transactionFilters = {
  all: null, sms: ['sms_spend'], refund: ['refund', 'reservation_release'], purchase: ['purchase'],
  transfer: ['transfer_in', 'transfer_out'], admin: ['admin_adjustment'],
};
const deliveryFilters = {
  all: null, delivered: ['delivered'], pending: ['queued', 'sent'],
  failed: ['failed', 'undelivered'], skipped: ['skipped'],
};

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function action(label, handler, primary = false) {
  const button = node('button', `feature-button${primary ? ' feature-primary' : ''}`, label);
  button.type = 'button';
  if (handler) button.addEventListener('click', handler);
  return button;
}

function toolbar(...items) {
  const element = node('div', 'settings-points-toolbar');
  element.append(...items);
  return element;
}

function labelledControl(label, input) {
  const field = node('label', 'feature-field', label);
  field.append(input);
  return field;
}

function metrics(entries, className) {
  const list = node('dl', className);
  for (const [label, value] of entries) {
    if (value == null) continue;
    const block = node('div');
    const data = node('dd', '', value);
    data.dir = 'auto';
    block.append(node('dt', '', label), data);
    list.append(block);
  }
  return list;
}

function filtersFor(filters, selection, onChange) {
  return toolbar(...Object.entries(filters).map(([key, label]) => {
    const button = action(label, () => onChange(key));
    button.setAttribute('aria-pressed', String(key === selection));
    return button;
  }));
}

function rowButton(label, value, onClick) {
  const button = action(label, onClick);
  button.classList.add('settings-points-row');
  button.append(node('span', 'settings-points-row-value', value));
  return button;
}

function note(text, live = false) {
  const paragraph = node('p', 'dialog-note', text);
  if (live) paragraph.setAttribute('role', 'status');
  return paragraph;
}

function failure(error) {
  const reason = error?.message?.split(':')[0];
  const code = error?.code?.split('/').at(-1);
  if (reason === 'request-already-pending') return 'alreadyPending';
  if (reason === 'insufficient-balance') return 'insufficient';
  if (reason?.startsWith('wallet-') || reason?.startsWith('recipient-wallet-')) return 'unavailableWallet';
  if (code === 'resource-exhausted') return 'dailyLimit';
  if (['deadline-exceeded', 'unavailable', 'unknown', 'internal'].includes(code)) return 'uncertain';
  return 'actionError';
}

export function createSettingsDevicesPoints({
  locale, client, user, row, showDialog, isActive, announce, getLocalCounts,
}) {
  const text = copy[locale === 'ar' ? 'ar' : 'en'];
  const number = new Intl.NumberFormat(locale);
  const time = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const fmt = value => Number.isFinite(value) ? number.format(value) : '—';
  const date = value => {
    const result = typeof value?.toDate === 'function' ? value.toDate() : value;
    return result && Number.isFinite(result.getTime?.()) ? time.format(result) : '—';
  };
  const amount = value => `${fmt(value)} ${text.unit}`;
  const state = value => Object.hasOwn(text.states, value) ? text.states[value] : '—';
  const name = item => item.displayName ? `${item.displayName} (@${item.username})` : `@${item.username}`;
  const signedAmount = item => `${item.direction === 'credit' ? '+' : '−'}${amount(item.amount)}`;
  const description = node('span', '', text.pointsSubtitle);
  let activeRoute;
  let disposed = false;
  let wallet;
  let walletError = false;
  let stopWallet;

  function stopRoute() {
    const route = activeRoute;
    activeRoute = null;
    for (const stop of route?.cleanup ?? []) stop();
  }

  function open(title, back) {
    stopRoute();
    const pane = node('div', 'settings-points-dialog');
    if (back) pane.append(toolbar(action(text.back, back)));
    const body = node('div', 'settings-points-body');
    pane.append(body);
    const route = { body, cleanup: [], active: () => activeRoute === route && pane.isConnected && isActive() };
    activeRoute = route;
    showDialog(title, pane);
    const host = pane.parentElement;
    if (host) {
      const observer = new MutationObserver(() => { if (activeRoute === route && !pane.isConnected) stopRoute(); });
      observer.observe(host, { childList: true });
      route.cleanup.push(() => observer.disconnect());
    }
    const dialog = pane.closest('dialog');
    const close = () => { if (activeRoute === route && !dialog.open) stopRoute(); };
    if (dialog) {
      dialog.addEventListener('close', close);
      route.cleanup.push(() => dialog.removeEventListener('close', close));
    }
    return route;
  }

  function watch(route, method, args, onValue, onError) {
    const guard = callback => value => { if (route.active()) callback(value); };
    try {
      route.cleanup.push(client[method](user.uid, ...args, guard(onValue), guard(onError)));
    } catch {
      guard(onError)();
    }
  }

  function subscribeWallet() {
    stopWallet?.();
    walletError = false;
    activeRoute?.walletChanged?.();
    try {
      stopWallet = client.watchPointsWallet(user.uid, value => {
        if (disposed) return;
        wallet = value;
        walletError = false;
        description.textContent = `${amount(value.balance)} · ${fmt(value.reserved)} ${text.reserved}`;
        activeRoute?.walletChanged?.();
      }, () => {
        if (disposed) return;
        walletError = true;
        activeRoute?.walletChanged?.();
      });
    } catch {
      walletError = true;
      activeRoute?.walletChanged?.();
    }
  }

  function walletMetrics() {
    return metrics([[text.balance, fmt(wallet.balance)], [text.reserved, fmt(wallet.reserved)],
      [text.available, fmt(wallet.available)]], 'settings-points-metrics');
  }

  function showWallet() {
    const route = open(text.points);
    const walletCard = node('section', 'settings-points-card');
    const transactions = node('section', 'settings-points-body');
    route.body.append(walletCard, transactions);
    route.walletChanged = () => {
      if (walletError) walletCard.replaceChildren(note(text.loadError), action(text.retry, subscribeWallet));
      else if (!wallet) walletCard.replaceChildren(note(text.loading, true));
      else walletCard.replaceChildren(walletMetrics(), note(text.reservedHelp),
        toolbar(action(text.request, showPackages, true), action(text.transfer, showTransferSearch)));
    };
    route.walletChanged();
    let filter = 'all';
    let entries;
    let historyError = false;
    const showHistory = () => {
      const keys = transactionFilters[filter];
      const visible = entries?.filter(item => !keys || keys.includes(item.type));
      transactions.replaceChildren(node('h3', '', text.history), filtersFor(text.filters, filter, choice => {
        filter = choice;
        showHistory();
        transactions.querySelector('button[aria-pressed="true"]')?.focus();
      }), ...(historyError ? [note(text.loadError)] : !visible ? [note(text.loading, true)] : visible.length === 0
        ? [note(text.noTransactions)]
        : visible.map(item => rowButton(`${text.types[item.type]} · ${date(item.createdAt)}`,
          signedAmount(item), () => showTransaction(item)))));
    };
    showHistory();
    watch(route, 'watchPointsTransactions', [], value => { entries = value; showHistory(); }, () => {
      historyError = true;
      showHistory();
    });
  }

  function showTransaction(item) {
    const route = open(text.types[item.type], showWallet);
    route.body.append(node('strong', 'settings-points-amount', signedAmount(item)),
      metrics([
        [text.id, item.id], [text.type, text.types[item.type]], [text.direction, text[item.direction]],
        [text.status, state(item.status)], [text.created, date(item.createdAt)], [text.completed, date(item.completedAt)],
        [text.transferId, item.relatedTransferId], [text.counterparty, item.relatedUserId], [text.note, item.note],
      ], 'settings-points-details'));
    if (item.sent != null || item.failed != null || item.refund != null) route.body.append(
      node('h3', '', text.smsSettlement), metrics([
        [text.sent, item.sent != null ? fmt(item.sent) : null], [text.failed, item.failed != null ? fmt(item.failed) : null],
        [text.refunded, item.refund != null ? amount(item.refund) : null],
      ], 'settings-points-details'));
    if (item.relatedSmsBatchId) route.body.append(action(text.report, () => showReport(item.relatedSmsBatchId, () => showTransaction(item))));
  }

  function submitConfirmed(route, heading, summary, label, submit, onSuccess) {
    const status = note('', true);
    let busy = false;
    const confirm = action(label, async () => {
      if (busy || !route.active()) return;
      busy = confirm.disabled = true;
      status.textContent = text.loading;
      try {
        const result = await submit();
        if (route.active()) onSuccess(result);
      } catch (error) {
        if (!route.active()) return;
        const message = failure(error);
        status.textContent = text[message];
        if (message !== 'uncertain') busy = confirm.disabled = false;
      }
    }, true);
    route.body.append(node('strong', '', heading), note(summary), confirm, status);
  }

  function showPackages() {
    const route = open(text.request, showWallet);
    const list = node('section', 'settings-points-body');
    route.body.append(note(text.requestNote), list, action(text.requests, showRequests));
    list.append(note(text.loading, true));
    watch(route, 'watchPointsPackages', [], packages => {
      list.replaceChildren(...(packages.length ? packages.map(item => rowButton(item.name || amount(item.points),
        amount(item.points), () => confirmRequest(item))) : [note(text.noPackages)]));
    }, () => list.replaceChildren(note(text.loadError)));
  }

  function confirmRequest(item) {
    const route = open(text.request, showPackages);
    submitConfirmed(route, item.name || amount(item.points), `${amount(item.points)} · ${text.confirmRequest}`,
      text.requestAction, () => client.call('createPointsRequest', { packageId: item.id }), () => {
        announce(text.requestSent);
        showRequests(text.requestSent);
      });
  }

  function showRequests(saved) {
    const route = open(text.requests, showPackages);
    const list = node('section', 'settings-points-body');
    if (typeof saved === 'string') route.body.append(note(saved, true));
    route.body.append(list);
    list.append(note(text.loading, true));
    watch(route, 'watchPointsRequests', [], requests => {
      list.replaceChildren(...(requests.length ? requests.map(item => {
        const block = node('section', 'settings-points-card');
        block.append(node('strong', '', item.packageName || amount(item.points)),
          note(`${amount(item.points)} · ${date(item.createdAt)} · ${state(item.status)}`));
        if (item.reviewNote && item.status === 'rejected') block.append(note(item.reviewNote));
        return block;
      }) : [note(text.noRequests)]));
    }, () => list.replaceChildren(note(text.loadError)));
  }

  function showTransferSearch() {
    const route = open(text.transfer, showWallet);
    if (wallet?.status !== 'active') { route.body.append(note(text.unavailableWallet)); return; }
    const form = node('form', 'feature-form');
    const query = node('input', 'feature-input');
    query.autocapitalize = 'none';
    query.autocomplete = 'off';
    query.maxLength = 21;
    query.dir = 'ltr';
    const search = action(text.search, null, true);
    search.type = 'submit';
    const results = node('section', 'settings-points-body');
    form.append(labelledControl(text.username, query), search);
    route.body.append(note(`${text.available} · ${amount(wallet.available)}`), form, results);
    let generation = 0;
    let timeout;
    route.cleanup.push(() => clearTimeout(timeout));
    async function find() {
      clearTimeout(timeout);
      const request = ++generation;
      const value = query.value.trim();
      results.replaceChildren();
      if (!value) return;
      results.append(note(text.loading, true));
      try {
        const users = await client.searchPointsRecipients(user.uid, value);
        if (route.active() && request === generation) results.replaceChildren(...(users.length
          ? users.map(item => rowButton(item.displayName || `@${item.username}`,
            item.displayName ? `@${item.username}` : '', () => showAmount(item))) : [note(text.noMatches)]));
      } catch {
        if (route.active() && request === generation) results.replaceChildren(note(text.loadError));
      }
    }
    form.addEventListener('submit', event => { event.preventDefault(); void find(); });
    query.addEventListener('input', () => {
      generation += 1;
      clearTimeout(timeout);
      results.replaceChildren();
      if (query.value.trim()) timeout = setTimeout(find, 200);
    });
  }

  function showAmount(item, initialAmount = '') {
    const route = open(text.transfer, showTransferSearch);
    const form = node('form', 'feature-form');
    const input = node('input', 'feature-input');
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.inputMode = 'numeric';
    input.required = true;
    input.value = initialAmount;
    const summary = note('');
    const next = action(text.continue, null, true);
    next.type = 'submit';
    form.append(node('strong', '', name(item)), labelledControl(text.amount, input), summary, next);
    route.body.append(form);
    const amountValue = () => Number(input.value);
    const valid = () => wallet?.status === 'active' && Number.isSafeInteger(amountValue())
      && amountValue() > 0 && amountValue() <= wallet.available;
    function update() {
      input.max = String(wallet?.available ?? 0);
      next.disabled = !valid();
      summary.textContent = wallet?.status !== 'active' ? text.unavailableWallet
        : amountValue() > wallet.available ? text.insufficient
          : `${text.available} · ${amount(wallet.available)} · ${text.remaining} · ${amount(wallet.available - amountValue())}`;
    }
    route.walletChanged = update;
    input.addEventListener('input', update);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (valid()) confirmTransfer(item, amountValue());
    });
    update();
  }

  function confirmTransfer(item, value) {
    const route = open(text.confirmTransfer, () => showAmount(item, String(value)));
    submitConfirmed(route, `${amount(value)} · ${name(item)}`,
      `${text.remaining} · ${amount(wallet.available - value)}`, text.confirmTransfer,
      () => client.call('transferPoints', { recipientUid: item.uid, amount: value }), result => {
        announce(text.transferred);
        const done = open(text.transferred, showWallet);
        done.body.append(note(`${amount(result.amount)} · ${name(item)}`),
          metrics([[text.transferId, result.transferId]], 'settings-points-details'));
      });
  }

  function showReport(batchId, back, retrySubmitted = false) {
    const route = open(text.report, back);
    if (retrySubmitted) route.body.append(note(text.retryAccepted, true));
    const report = node('section', 'settings-points-body');
    route.body.append(report);
    let batch;
    let recipients;
    let filter = 'all';
    let error = false;
    const names = new Map();
    const requested = new Set();

    function draw() {
      if (error || batch === null) { report.replaceChildren(note(text.loadError)); return; }
      if (!batch || !recipients) { report.replaceChildren(note(text.loading, true)); return; }
      const inFilter = (item, key) => !deliveryFilters[key] || deliveryFilters[key].includes(item.smsStatus);
      const visible = recipients.filter(item => inFilter(item, filter));
      const count = key => recipients.filter(item => inFilter(item, key)).length;
      const stats = metrics([
        [text.total, fmt(recipients.length)], [text.delivered, fmt(count('delivered'))], [text.pending, fmt(count('pending'))],
        [text.failed, fmt(count('failed'))], [text.skipped, fmt(count('skipped'))], [text.spent, fmt(batch.pointsDeducted ?? 0)],
        [text.refunded, fmt(batch.pointsRefunded ?? 0)], [text.reserved, fmt(batch.pointsReserved ?? 0)],
      ], 'settings-points-metrics');
      const info = metrics([
        [text.batchId, batch.offlineSmsBatchId ?? batch.gatewayBatchId ?? batch.id], [text.status, state(batch.status)],
        [text.audience, batch.audienceCanonical ?? batch.audience], [text.attempt, fmt(batch.attemptNumber ?? 1)],
        [text.created, date(batch.createdAt)], [text.updated, date(batch.updatedAt)], [text.lastReport, date(batch.lastDeliveryReportAt)],
      ], 'settings-points-details');
      const filterButtons = filtersFor({ all: text.filters.all, delivered: text.delivered, pending: text.pending,
        failed: text.failed, skipped: text.skipped }, filter, selection => {
        filter = selection;
        draw();
        report.querySelector('button[aria-pressed="true"]')?.focus();
      });
      const list = node('ul', 'feature-comments');
      for (const item of visible) {
        const entry = node('li');
        entry.append(node('strong', '', names.get(item.uid) || text.recipient), note([
          item.maskedPhone && !/^\+?\d+$/.test(item.maskedPhone) ? item.maskedPhone : '', state(item.smsStatus),
        ].filter(Boolean).join(' · ')));
        list.append(entry);
      }
      report.replaceChildren(stats, info, filterButtons, ...(list.childElementCount ? [list] : [note(text.noRecipients)]));
      if (recipients.some(item => item.smsStatus === 'failed')) report.append(action(text.retryFailed,
        () => confirmRetry(batchId, () => showReport(batchId, back)), true));
    }

    function onError() { error = true; draw(); }
    draw();
    watch(route, 'watchPointsSmsBatch', [batchId], value => { batch = value; draw(); }, onError);
    watch(route, 'watchPointsSmsRecipients', [batchId], value => {
      recipients = value;
      draw();
      const ids = recipients.map(item => item.uid).filter(uid => !uid.startsWith('ext:') && !requested.has(uid));
      if (!ids.length || !client.getGroupMemberProfiles) return;
      ids.forEach(uid => requested.add(uid));
      void client.getGroupMemberProfiles(user.uid, ids).then(profiles => {
        if (!route.active()) return;
        for (const profile of profiles) if (profile?.uid) {
          names.set(profile.uid, profile.displayName || (profile.username ? `@${profile.username}` : ''));
        }
        draw();
      }).catch(() => { ids.forEach(uid => requested.delete(uid)); });
    }, onError);
  }

  function confirmRetry(batchId, back) {
    const route = open(text.retryFailed, back);
    submitConfirmed(route, text.retryFailed, text.confirmRetry, text.confirm,
      () => client.call('retryFailedSmsRecipients', { batchId }), result => {
        announce(text.retryAccepted);
        showReport(result.batchId, back, true);
      });
  }

  function showDevices() {
    const route = open(text.devices);
    route.body.append(node('strong', '', text.devicesEmpty), note(text.devicesNote));
  }

  const points = row({ label: text.points, description, icon: 'points', onClick: showWallet });
  const devices = row({ label: text.devices, icon: 'devices', onClick: showDevices });
  const storage = node('section', 'settings-browser-storage');
  const counts = getLocalCounts();
  storage.append(node('h2', '', text.storage), note(text.storageNote),
    metrics([[text.chats, fmt(counts.chats)], [text.messages, fmt(counts.messages)]], 'settings-points-metrics'));
  subscribeWallet();
  return { points, devices, storage, dispose() {
    disposed = true;
    stopRoute();
    stopWallet?.();
  } };
}
