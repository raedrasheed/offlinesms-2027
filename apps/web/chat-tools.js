const labels = {
  en: {
    messageActions: 'Message actions', reply: 'Reply', reactions: 'Reactions', forward: 'Forward',
    copy: 'Copy text', copied: 'Message copied.', copyFallback: 'Select and copy this text.',
    edit: 'Edit message', remove: 'Delete message', removeHint: 'Delete this message for everyone in the conversation?',
    save: 'Save changes', cancel: 'Cancel', deleted: 'Message deleted.', edited: 'Message updated.',
    chooseChat: 'Choose a conversation', noChats: 'No conversations are available.',
    forwarded: 'Message forwarded.', message: 'Message',
    react: 'React with', reactAction: 'React', moreReactions: 'More reactions', chooseCopy: 'Copy message text',
    pin: 'Pin message', unpin: 'Unpin message', star: 'Star message', unstar: 'Unstar message',
    pinned: 'Message pinned.', unpinned: 'Message unpinned.', starred: 'Message starred.', unstarred: 'Star removed.',
    info: 'Message info', time: 'Time', sender: 'Sender', you: 'You',
    infoLoading: 'Loading delivery details…', infoFailed: 'Could not load delivery details.',
    delivered: 'Delivered', read: 'Read', viewed: 'Viewed', played: 'Played', pending: 'Pending', failed: 'Failed',
    recipients: 'Recipients', unnamedRecipient: 'Recipient',
    actionFailed: 'Could not complete the action. Try again.',
    actionDenied: 'You do not have permission to perform this action.',
    editExpired: 'The time limit for editing this message has passed.',
  },
  ar: {
    messageActions: 'خيارات الرسالة', reply: 'رد', reactions: 'التفاعلات', forward: 'إعادة التوجيه',
    copy: 'نسخ النص', copied: 'تم نسخ الرسالة.', copyFallback: 'حدد النص وانسخه.',
    edit: 'تعديل الرسالة', remove: 'حذف الرسالة', removeHint: 'هل تريد حذف هذه الرسالة لدى جميع المشاركين في المحادثة؟',
    save: 'حفظ التعديل', cancel: 'إلغاء', deleted: 'تم حذف الرسالة.', edited: 'تم تعديل الرسالة.',
    chooseChat: 'اختر محادثة', noChats: 'لا توجد محادثات متاحة.',
    forwarded: 'تمت إعادة توجيه الرسالة.', message: 'الرسالة',
    react: 'تفاعل بـ', reactAction: 'تفاعل', moreReactions: 'تفاعلات أخرى', chooseCopy: 'نسخ نص الرسالة',
    pin: 'تثبيت الرسالة', unpin: 'إلغاء تثبيت الرسالة', star: 'تمييز بنجمة', unstar: 'إزالة النجمة',
    pinned: 'ثُبّتت الرسالة.', unpinned: 'أُلغي تثبيت الرسالة.', starred: 'مُيّزت الرسالة بنجمة.', unstarred: 'أُزيلت النجمة.',
    info: 'معلومات الرسالة', time: 'الوقت', sender: 'المرسل', you: 'أنت',
    infoLoading: 'جارٍ تحميل تفاصيل التسليم…', infoFailed: 'تعذر تحميل تفاصيل التسليم.',
    delivered: 'تم التسليم', read: 'مقروءة', viewed: 'شوهدت', played: 'شُغّلت', pending: 'قيد الانتظار', failed: 'تعذر التسليم',
    recipients: 'المستلمون', unnamedRecipient: 'مستلم',
    actionFailed: 'تعذر إكمال الإجراء. حاول مرة أخرى.',
    actionDenied: 'ليس لديك إذن لتنفيذ هذا الإجراء.',
    editExpired: 'انتهت المهلة المتاحة لتعديل هذه الرسالة.',
  },
};

const emojiChoices = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const allReactions = [...emojiChoices, '😍', '🔥', '👏', '🎉', '🙌', '🤔', '😅', '🤩', '💯', '✨'];
const receiptStates = ['delivered', 'read', 'viewed', 'played', 'pending', 'failed'];
const actionIcons = {
  reply: 'M9 9 5 13l4 4M5 13h9a4 4 0 0 1 4 4',
  copy: 'M8 16H5V4h10v3M8 7h11v13H8z',
  react: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM8 13.5a4.3 4.3 0 0 0 8 0m-6.8-4H9m6 0h-.2',
  forward: 'm15 5 4 4-4 4m4-4h-7a6 6 0 0 0-6 6v2',
  pin: 'M16 3H8m1 0v7l-4 4v2h14v-2l-4-4V3m-3 13v5',
  star: 'm12 3 2.7 5.7 6.3.9-4.6 4.4 1.1 6.3-5.5-3-5.5 3 1.1-6.3L3 9.6l6.3-.9L12 3Z',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-1v5m0-8h.01',
  edit: 'm4 20 1-5L16 4l4 4L9 19l-5 1ZM14 6l4 4',
  remove: 'M4 6h16M9 6V3h6v3M6 6l1 14h10l1-14m-8 4v6m4-6v6',
};

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function actionButton(text, onClick, variant = '') {
  const button = element('button', 'chat-tool-button' + (variant ? ' ' + variant : ''), text);
  button.type = 'button';
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

function messageActionButton(icon, text, onClick, variant) {
  const button = actionButton(text, onClick, variant);
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.classList.add('chat-tool-icon-' + icon);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', actionIcons[icon]);
  svg.append(path);
  button.prepend(svg);
  return button;
}

function field(label, control) {
  const wrapper = element('label', 'chat-tool-field');
  wrapper.append(element('span', '', label), control);
  control.dir = 'auto';
  return wrapper;
}

function messageInput(value, maxLength, rows) {
  const input = element('textarea', 'chat-tool-input');
  input.value = value;
  input.maxLength = maxLength;
  input.rows = rows;
  input.required = true;
  return input;
}

export function createChatTools({
  getLanguage, showDialog, closeDialog, getThreads, forwardMessage,
  setReply, updateMessage, deleteMessage, toggleReaction, togglePin, toggleStar, getMessageInfo, announce, canUseMessage = () => true,
}) {
  const copy = () => labels[getLanguage()] ?? labels.en;
  const pendingActions = new Set();
  let openPopover;

  function dialogError() {
    const error = element('p', 'chat-tool-error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    return error;
  }

  function actionError(error, t) {
    if (error?.message === 'edit-window-closed') return t.editExpired;
    if (String(error?.code).endsWith('permission-denied')) return t.actionDenied;
    return t.actionFailed;
  }

  async function perform(key, operation, t, { content, error, control, success } = {}) {
    if (pendingActions.has(key)) return;
    pendingActions.add(key);
    if (control) control.disabled = true;
    if (error) error.hidden = true;
    try {
      await operation();
      if (content?.closest('dialog[open]')) closeDialog();
      if (success) announce(success);
    } catch (failure) {
      const feedback = actionError(failure, t);
      if (error && content?.closest('dialog[open]')) {
        error.textContent = feedback;
        error.hidden = false;
      } else announce(feedback);
    } finally {
      if (control) control.disabled = false;
      pendingActions.delete(key);
    }
  }

  const actionKey = (operation, message) => JSON.stringify([operation, message.conversationId, message.id]);

  async function copyMessage(message, t) {
    if (!canUseMessage(message)) return;
    try {
      await navigator.clipboard.writeText(message.text);
      if (!canUseMessage(message)) return;
      closeDialog();
      announce(t.copied);
    } catch {
      if (!canUseMessage(message)) return;
      const content = element('div', 'chat-tool-stack');
      const input = messageInput(message.text, 4000, 3);
      input.readOnly = true;
      content.append(element('p', 'chat-tool-note', t.copyFallback), field(t.message, input));
      showDialog(t.chooseCopy, content);
      input.focus();
      input.select();
    }
  }

  function showForward(message, t) {
    const content = element('div', 'chat-tool-stack');
    const error = dialogError();
    const threads = getThreads();
    if (!threads.length) content.append(element('p', 'chat-tool-note', t.noChats));
    threads.forEach((thread) => {
      const target = actionButton(thread.name, () => {
        void perform(actionKey('forward', message), async () => {
          const result = await forwardMessage(thread.id, message);
          if (result?.forwarded === 0) throw new Error('nothing-forwarded');
        }, t, { content, error, control: target, success: t.forwarded });
      });
      content.append(target);
    });
    content.append(error);
    showDialog(t.chooseChat, content);
  }

  function showEdit(message, t) {
    const form = element('form', 'chat-tool-stack');
    const input = messageInput(message.text, 4000, 4);
    const error = dialogError();
    const buttons = element('div', 'chat-tool-buttons');
    const save = actionButton(t.save, null, 'primary');
    save.type = 'submit';
    buttons.append(actionButton(t.cancel, closeDialog), save);
    form.append(field(t.message, input), error, buttons);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      void perform(actionKey('edit', message), () => updateMessage(message.id, text, message), t, {
        content: form, error, control: save, success: t.edited,
      });
    });
    showDialog(t.edit, form);
    input.focus();
  }

  function showDelete(message, t) {
    const content = element('div', 'chat-tool-stack');
    const error = dialogError();
    const buttons = element('div', 'chat-tool-buttons');
    const remove = actionButton(t.remove, () => {
      void perform(actionKey('delete', message), () => deleteMessage(message.id, message), t, {
        content, error, control: remove, success: t.deleted,
      });
    }, 'danger');
    buttons.append(actionButton(t.cancel, closeDialog), remove);
    content.append(element('p', 'chat-tool-note', t.removeHint), error, buttons);
    showDialog(t.remove, content);
  }

  function detailRow(list, label, value) {
    if (typeof value !== 'string' || !value) return;
    const detail = element('dd', '', value);
    detail.dir = 'auto';
    list.append(element('dt', '', label), detail);
  }

  async function showInfo(message, t) {
    const content = element('div', 'chat-tool-stack');
    const details = element('dl', 'chat-tool-info');
    const sender = message.authorLabel || (message.author === 'you' ? t.you : '');
    detailRow(details, t.sender, sender);
    detailRow(details, t.time, message.timeLabel ?? message.time);
    details.hidden = !details.children.length;
    const preview = element('p', 'chat-tool-info-preview', message.text);
    preview.dir = 'auto';
    if (message.text) content.append(preview);
    content.append(details);
    const activity = element('div', 'chat-tool-receipts');
    activity.setAttribute('aria-live', 'polite');
    if (getMessageInfo) {
      activity.append(element('p', 'chat-tool-note', t.infoLoading));
      content.append(activity);
    }
    showDialog(t.info, content);
    if (!getMessageInfo) return;

    try {
      const data = await getMessageInfo(message);
      if (!sender) detailRow(details, t.sender, data?.senderDisplayName);
      details.hidden = !details.children.length;
      activity.replaceChildren();
      const summary = element('dl', 'chat-tool-info');
      const aggregates = data?.aggregates ?? data?.receiptCounts;
      const formatNumber = new Intl.NumberFormat(getLanguage());
      for (const status of receiptStates) {
        const count = aggregates?.[status + 'Count'];
        if (Number.isInteger(count) && count >= 0) detailRow(summary, t[status], formatNumber.format(count));
      }
      if (summary.children.length) activity.append(summary);
      if (Array.isArray(data?.recipients) && data.recipients.length) {
        const list = element('dl', 'chat-tool-info chat-tool-recipient-list');
        for (const recipient of data.recipients) {
          if (!receiptStates.includes(recipient?.status)) continue;
          detailRow(list, recipient.displayName || t.unnamedRecipient, t[recipient.status]);
        }
        if (list.children.length) activity.append(element('h3', '', t.recipients), list);
      }
    } catch {
      activity.replaceChildren(element('p', 'chat-tool-error', t.infoFailed));
    }
  }

  function dismissPopover(restoreFocus = false) {
    if (!openPopover) return;
    const { anchor, panel, listeners } = openPopover;
    openPopover = null;
    listeners.abort();
    anchor.setAttribute('aria-expanded', 'false');
    panel.remove();
    if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
  }

  function positionPopover(anchor, panel) {
    if (!anchor.isConnected || !anchor.getClientRects().length) {
      dismissPopover();
      return false;
    }
    const conversation = anchor.closest('.conversation')?.getBoundingClientRect();
    const body = anchor.closest('.conversation-body')?.getBoundingClientRect();
    const button = anchor.getBoundingClientRect();
    if (body && (button.bottom < body.top || button.top > body.bottom)) {
      dismissPopover();
      return false;
    }
    const left = Math.max(8, (conversation?.left ?? 0) + 8);
    const right = Math.min(window.innerWidth, conversation?.right ?? window.innerWidth) - 8;
    const top = Math.max(8, (conversation?.top ?? 0) + 8);
    const bottom = Math.min(window.innerHeight, conversation?.bottom ?? window.innerHeight) - 8;
    panel.style.maxWidth = `${right - left}px`;
    panel.style.maxHeight = `${bottom - top}px`;
    const { width, height } = panel.getBoundingClientRect();
    const outgoing = anchor.closest('.message-row')?.classList.contains('outgoing') ?? false;
    const preferLeft = outgoing !== (document.documentElement.dir === 'rtl');
    const leftOfButton = button.left - width + 26;
    const rightOfButton = button.right - 26;
    const opensLeft = leftOfButton >= left && (preferLeft || rightOfButton + width > right);
    const x = opensLeft ? leftOfButton : rightOfButton;
    const y = button.top;
    panel.dataset.side = opensLeft ? 'left' : 'right';
    panel.style.left = `${Math.max(left, Math.min(x, right - width))}px`;
    panel.style.top = `${Math.max(top, Math.min(y, bottom - height))}px`;
    return true;
  }

  function openAnchoredActions(anchor, panel, label) {
    panel.classList.add('chat-tool-popover');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', label);
    anchor.setAttribute('aria-haspopup', 'dialog');
    anchor.setAttribute('aria-expanded', 'true');
    document.body.append(panel);
    const listeners = new AbortController();
    openPopover = { anchor, panel, listeners };
    if (!positionPopover(anchor, panel)) return;

    const { signal } = listeners;
    document.addEventListener('pointerdown', (event) => {
      if (!panel.contains(event.target) && !anchor.contains(event.target)) dismissPopover();
    }, { signal });
    document.addEventListener('focusin', (event) => {
      if (!panel.contains(event.target) && !anchor.contains(event.target)) dismissPopover();
    }, { signal });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissPopover(true);
      }
    }, { signal });
    window.addEventListener('resize', () => positionPopover(anchor, panel), { signal });
    window.addEventListener('scroll', () => positionPopover(anchor, panel), { signal, capture: true });
    panel.querySelector('button')?.focus({ preventScroll: true });
  }

  function reactionButtons(message, t, choices, onReact) {
    const reactions = element('div', 'chat-tool-reactions');
    reactions.setAttribute('role', 'group');
    reactions.setAttribute('aria-label', t.reactions);
    choices.forEach((emoji) => {
      const button = actionButton(emoji, () => onReact(emoji), 'reaction');
      button.setAttribute('aria-label', t.react + ' ' + emoji);
      button.setAttribute('aria-pressed', String(
        message.myReaction ? message.myReaction === emoji
          : Array.isArray(message.myReactions) && message.myReactions.includes(emoji),
      ));
      reactions.append(button);
    });
    return reactions;
  }

  function showReactionPicker(message, t) {
    const picker = reactionButtons(message, t, allReactions, (emoji) => {
      closeDialog();
      void perform(actionKey('react', message), () => toggleReaction(message.id, emoji, message), t);
    });
    picker.classList.add('chat-tool-reaction-picker');
    showDialog(t.reactions, picker);
  }

  function showMessageActions(message, anchor, { reactionsOnly = false } = {}) {
    if (openPopover && openPopover.anchor === anchor) {
      dismissPopover(true);
      return;
    }
    dismissPopover();
    const t = copy();
    const canReact = toggleReaction && message.canReact !== false && !message.deletedForEveryone;
    if (reactionsOnly && !canReact) return;

    const content = element('div', 'chat-tool-stack');
    const run = (handler) => () => {
      if (anchor) dismissPopover(true);
      handler();
    };
    if (canReact) {
      const reactions = reactionButtons(message, t, emojiChoices, (emoji) => {
        if (anchor) dismissPopover(true);
        else closeDialog();
        void perform(actionKey('react', message), () => toggleReaction(message.id, emoji, message), t);
      });
      const more = actionButton('+', run(() => showReactionPicker(message, t)), 'reaction more-reactions');
      more.setAttribute('aria-label', t.moreReactions);
      reactions.append(more);
      content.append(reactions);
    }
    if (reactionsOnly) {
      if (anchor) openAnchoredActions(anchor, content, t.reactions);
      else showDialog(t.reactions, content);
      return;
    }
    const actions = element('div', 'chat-tool-actions');
    if (setReply && message.canReply !== false && !message.deletedForEveryone) {
      actions.append(messageActionButton('reply', t.reply, run(() => {
        closeDialog();
        void perform(actionKey('reply', message), () => setReply(message), t);
      })));
    }
    if (message.text && message.canCopy !== false && !message.deletedForEveryone) {
      actions.append(messageActionButton('copy', t.copy, run(() => { void copyMessage(message, t); })));
    }
    if (canReact) actions.append(messageActionButton('react', t.reactAction, run(() => showReactionPicker(message, t))));
    if (forwardMessage && getThreads && message.canForward !== false && message.type !== 'poll' && !message.deletedForEveryone) {
      actions.append(messageActionButton('forward', t.forward, run(() => showForward(message, t))));
    }
    if (togglePin && message.canPin !== false && !message.deletedForEveryone) {
      actions.append(messageActionButton('pin', message.pinned ? t.unpin : t.pin, run(() => {
        closeDialog();
        const key = JSON.stringify(['pin', message.conversationId]);
        void perform(key, () => togglePin(message), t, { success: message.pinned ? t.unpinned : t.pinned });
      }), message.pinned ? 'marked' : ''));
    }
    if (toggleStar && message.canStar !== false && !message.deletedForEveryone) {
      actions.append(messageActionButton('star', message.starred ? t.unstar : t.star, run(() => {
        closeDialog();
        void perform(actionKey('star', message), () => toggleStar(message), t, {
          success: message.starred ? t.unstarred : t.starred,
        });
      }), message.starred ? 'marked' : ''));
    }
    actions.append(messageActionButton('info', t.info, run(() => { void showInfo(message, t); })));
    const own = message.author === 'you';
    if (updateMessage && (message.canEdit ?? own) && (!message.type || message.type === 'text') && !message.deletedForEveryone) {
      actions.append(messageActionButton('edit', t.edit, run(() => showEdit(message, t))));
    }
    if (deleteMessage && (message.canDelete ?? own) && !message.deletedForEveryone) {
      actions.append(messageActionButton('remove', t.remove, run(() => showDelete(message, t)), 'danger'));
    }
    content.append(actions);
    if (anchor) openAnchoredActions(anchor, content, t.messageActions);
    else showDialog(t.messageActions, content);
  }

  return { showMessageActions, dismiss: dismissPopover };
}
