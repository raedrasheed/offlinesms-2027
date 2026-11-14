import { buildDefaultSmsBody, smsErrorReason } from '../mobile/src/lib/sms.helpers.ts';

const SMS_BODY_LIMIT = 320;
const audiences = ['unread_only', 'undelivered_only', 'everyone'];
const labels = {
  ar: {
    audience: 'المستلمون', unread_only: 'من لم يقرأوا الرسالة', undelivered_only: 'من لم تصلهم الرسالة',
    everyone: 'جميع المستلمين', body: 'نص الرسالة القصيرة', preview: 'معاينة الإرسال',
    loading: 'جارٍ حساب التكلفة ومعاينة المستلمين…', review: 'راجع النص والتكلفة قبل الإرسال',
    finalText: 'النص الذي سيُرسل', recipients: 'المستلمون المؤهلون', excluded: 'المستلمون المستبعدون',
    cost: 'التكلفة بالنقاط', balance: 'الرصيد المتاح', segments: 'أجزاء SMS لكل مستلم',
    unnamed: 'مستلم', confirm: 'تأكيد الإرسال', sending: 'جارٍ تسليم الطلب إلى OfflineSMS…',
    noRecipients: 'لا يوجد مستلمون مؤهلون للإرسال بهذه الإعدادات.',
    cap: 'عدد المستلمين المؤهلين يتجاوز الحد المسموح به للدفعة.',
    insufficient: 'رصيد النقاط غير كافٍ لإرسال هذه الدفعة.',
    empty: 'اكتب نص الرسالة القصيرة أولًا.',
    tooLong: 'يجب ألا يتجاوز نص الرسالة 320 حرفًا.',
    changed: 'تغيّر النص أو المستلمون أو التكلفة. اطلب معاينة جديدة ثم أكّد الإرسال.',
    denied: 'ليس لديك إذن بالإرسال عبر OfflineSMS لهذه الرسالة.',
    unavailable: 'تعذّرت معاينة الإرسال. حاول مرة أخرى.',
    sendUnknown: 'تعذّر تأكيد نتيجة الإرسال. تحقّق من حالة الرسالة قبل إعادة المحاولة.',
    failed: 'لم يقبل OfflineSMS أي عملية إرسال في هذه الدفعة.',
    submitted: 'تم تسليم الطلب إلى OfflineSMS للمعالجة.',
    resultAccepted: 'مقبولة للمعالجة', resultFailed: 'عمليات الإرسال الفاشلة', resultSkipped: 'المستلمون المستبعدون',
  },
  en: {
    audience: 'Recipients', unread_only: 'Recipients who haven’t read it',
    undelivered_only: 'Recipients who haven’t received it', everyone: 'All recipients',
    body: 'SMS text', preview: 'Preview sending', loading: 'Checking recipients and cost…',
    review: 'Review the text and cost before sending', finalText: 'Text to be sent',
    recipients: 'Eligible recipients', excluded: 'Excluded recipients', cost: 'Cost in points',
    balance: 'Available points', segments: 'SMS segments per recipient', unnamed: 'Recipient',
    confirm: 'Confirm and send', sending: 'Submitting the request to OfflineSMS…',
    noRecipients: 'There are no eligible recipients for these settings.',
    cap: 'The number of eligible recipients exceeds the batch limit.',
    insufficient: 'There are not enough points to send this batch.',
    empty: 'Enter the SMS text first.', tooLong: 'The SMS text must be 320 characters or fewer.',
    changed: 'The text, recipients, or cost changed. Request a new preview, then confirm again.',
    denied: 'You don’t have permission to send this message through OfflineSMS.',
    unavailable: 'Could not preview sending. Try again.',
    sendUnknown: 'Could not confirm the result. Check the message status before sending again.',
    failed: 'OfflineSMS could not accept any sends in this batch.',
    submitted: 'The request was submitted to OfflineSMS for processing.',
    resultAccepted: 'Accepted for processing', resultFailed: 'Failed sends', resultSkipped: 'Excluded recipients',
  },
};

function node(tag, className, value = '') {
  const item = document.createElement(tag);
  if (className) item.className = className;
  item.textContent = value;
  return item;
}

function smallButton(label, primary = false) {
  const button = node('button', primary ? 'feature-button feature-primary' : 'feature-button', label);
  button.type = 'button';
  return button;
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isQuote(result, audience) {
  return result?.audience === audience && typeof result.finalSmsBody === 'string'
    && typeof result.quoteToken === 'string' && result.quoteToken.length > 0
    && typeof result.exceedsCap === 'boolean'
    && [result.eligibleCount, result.excludedCount, result.pointsCost, result.walletBalance, result.smsSegments].every(safeCount);
}

function isPermissionError(error) {
  return typeof error?.code === 'string' && error.code.split('/').at(-1) === 'permission-denied';
}

export function createMessageInfoSms({ message, locale, call, isActive, onBusyChange = () => {} }) {
  const text = labels[locale === 'ar' ? 'ar' : 'en'];
  const numbers = new Intl.NumberFormat(locale);
  const identity = { messageId: message.id ?? message.messageId, conversationId: message.conversationId };
  const root = node('section', 'message-info-sms-flow');
  const form = node('form', 'feature-form');
  form.noValidate = true;
  const audienceField = node('label', 'feature-field', text.audience);
  const audience = node('select', 'feature-input');
  audiences.forEach((key) => {
    const option = node('option', '', text[key]);
    option.value = key;
    audience.append(option);
  });
  audienceField.append(audience);
  const bodyField = node('label', 'feature-field', text.body);
  const body = node('textarea', 'feature-input');
  body.rows = 4;
  body.dir = 'auto';
  body.required = true;
  body.maxLength = SMS_BODY_LIMIT;
  body.value = buildDefaultSmsBody(typeof message.text === 'string' ? message.text : '');
  bodyField.append(body);
  const previewButton = smallButton(text.preview, true);
  previewButton.type = 'submit';
  const notice = node('p', 'message-info-note');
  notice.hidden = true;
  notice.tabIndex = -1;
  notice.setAttribute('role', 'status');
  const quoteView = node('section', 'feature-form message-info-sms-quote');
  form.append(audienceField, bodyField, previewButton);
  root.append(form, notice, quoteView);

  let generation = 0;
  let sending = false;
  const active = () => root.isConnected && isActive();

  function status(messageCopy = '') {
    notice.textContent = messageCopy;
    notice.hidden = !messageCopy;
  }

  function invalidate() {
    generation += 1;
    previewButton.disabled = sending;
    quoteView.replaceChildren();
    status();
  }

  body.addEventListener('input', invalidate);
  audience.addEventListener('change', invalidate);

  function metrics(entries) {
    const list = node('ul', 'feature-comments');
    for (const [label, value] of entries) {
      if (safeCount(value)) list.append(node('li', '', `${label} · ${numbers.format(value)}`));
    }
    return list;
  }

  function canSend(quote) {
    return quote.eligibleCount > 0 && !quote.exceedsCap
      && quote.pointsCost > 0 && quote.walletBalance >= quote.pointsCost && Boolean(quote.finalSmsBody.trim());
  }

  function renderQuote(quote, request, revision) {
    const quoteHeading = node('h4', '', text.review);
    quoteHeading.tabIndex = -1;
    const final = node('p', 'message-info-sms-preview', quote.finalSmsBody);
    final.dir = 'auto';
    quoteView.append(quoteHeading, metrics([
      [text.recipients, quote.eligibleCount], [text.excluded, quote.excludedCount],
      [text.cost, quote.pointsCost], [text.balance, quote.walletBalance], [text.segments, quote.smsSegments],
    ]), node('strong', '', text.finalText), final);

    if (Array.isArray(quote.eligibleRecipients) && quote.eligibleRecipients.length) {
      const recipientList = node('ul', 'feature-comments message-info-sms-recipients');
      const recipients = node('details', '');
      recipients.append(node('summary', '', text.recipients), recipientList);
      for (const recipient of quote.eligibleRecipients) {
        const label = recipient?.displayName || text.unnamed;
        const row = node('li', '', label);
        row.dir = 'auto';
        if (typeof recipient?.maskedPhone === 'string' && recipient.maskedPhone.includes('•')) {
          const phone = node('bdi', '', recipient.maskedPhone);
          phone.dir = 'ltr';
          row.append(' · ', phone);
        }
        recipientList.append(row);
      }
      quoteView.append(recipients);
    }

    const confirm = smallButton(text.confirm, true);
    confirm.disabled = !canSend(quote);
    confirm.addEventListener('click', () => void submit(quote, request, revision));
    quoteView.append(confirm);
    if (!quote.eligibleCount) status(text.noRecipients);
    else if (quote.exceedsCap) status(text.cap);
    else if (quote.walletBalance < quote.pointsCost) status(text.insufficient);
    quoteHeading.focus();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending || previewButton.disabled || !active()) return;
    const request = { ...identity, audience: audience.value, smsBody: body.value.trim() };
    invalidate();
    if (!request.smsBody) { status(text.empty); body.focus(); return; }
    if (request.smsBody.length > SMS_BODY_LIMIT) { status(text.tooLong); body.focus(); return; }
    const revision = generation;
    previewButton.disabled = true;
    status(text.loading);
    try {
      const quote = await call('previewSmsEscalation', request);
      if (!active() || revision !== generation) return;
      if (!isQuote(quote, request.audience)) { status(text.unavailable); return; }
      status();
      renderQuote(quote, request, revision);
    } catch (error) {
      if (active() && revision === generation) status(isPermissionError(error) ? text.denied : text.unavailable);
    } finally {
      if (active() && revision === generation) previewButton.disabled = false;
    }
  });

  async function submit(quote, request, revision) {
    if (!active() || sending || revision !== generation || !canSend(quote)) return;
    if (request.audience !== audience.value || request.smsBody !== body.value.trim()) {
      invalidate();
      status(text.changed);
      return;
    }
    sending = true;
    invalidate();
    previewButton.disabled = audience.disabled = body.disabled = true;
    onBusyChange(true);
    status(text.sending);
    try {
      const result = await call('escalateSms', { ...request, quoteToken: quote.quoteToken });
      if (!active()) return;
      if (typeof result?.batchId !== 'string' || !result.batchId
        || !['accepted', 'partial', 'failed', 'sending', 'completed'].includes(result.status)) {
        status(text.sendUnknown);
        return;
      }
      form.hidden = true;
      const failed = result?.status === 'failed';
      const accepted = ['accepted', 'partial'].includes(result?.status) ? result.sent : undefined;
      status(failed ? text.failed : text.submitted);
      quoteView.append(metrics([[text.resultAccepted, accepted], [text.resultFailed, result?.failed], [text.resultSkipped, result?.skipped]]));
    } catch (error) {
      if (!active()) return;
      const reason = smsErrorReason(error);
      status(reason === 'sms-quote-changed' || reason === 'sms-preview-required' ? text.changed
        : reason === 'not-enough-points' ? text.insufficient
        : reason === 'no-eligible-recipients' ? text.noRecipients
        : isPermissionError(error) ? text.denied : text.sendUnknown);
    } finally {
      sending = false;
      if (active()) {
        previewButton.disabled = audience.disabled = body.disabled = false;
        onBusyChange(false);
        notice.focus();
      }
    }
  }

  return root;
}
