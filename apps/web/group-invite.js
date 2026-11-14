import { inviteProblem } from '../mobile/src/lib/inviteJoinModel.ts';
import { normalizeUsername, USERNAME_MAX, USERNAME_MIN, validateUsername } from '../mobile/src/lib/username.ts';

const labels = {
  ar: {
    title: 'دعوة إلى مجموعة', join: 'الانضمام إلى المجموعة', request: 'طلب الانضمام', open: 'فتح المجموعة',
    direct: 'انضمام مباشر', approval: 'يتطلب موافقة مشرف', members: 'عدد الأعضاء',
    loading: 'جارٍ تحميل الدعوة…', working: 'جارٍ تنفيذ الطلب…', pending: 'طلب انضمامك بانتظار موافقة مشرف المجموعة.',
    refresh: 'تحديث حالة الطلب', cancel: 'إلغاء الطلب', retry: 'إعادة المحاولة',
    username: 'اختر اسم مستخدم قبل الانضمام إلى هذه المجموعة.', usernameLabel: 'اسم المستخدم',
    usernameHint: 'من 3 إلى 20 حرفًا إنجليزيًا أو رقمًا. يمكن استخدام النقطة والشرطة السفلية في الوسط.',
    usernameInvalid: 'اسم المستخدم غير صالح. اختر اسمًا آخر.', usernameTaken: 'اسم المستخدم مستخدم بالفعل.',
    displayName: 'الاسم المعروض', saveProfile: 'حفظ الملف الشخصي', profileFailed: 'تعذّر حفظ الملف الشخصي. حاول مرة أخرى.',
    expired: 'رابط الدعوة غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا من مشرف المجموعة.',
    disabled: 'رابط الدعوة معطّل. اطلب رابطًا جديدًا من مشرف المجموعة.',
    full: 'المجموعة ممتلئة. تواصل مع مشرف المجموعة.',
    permission: 'ليس لديك إذن بالانضمام إلى هذه المجموعة. تواصل مع مشرف المجموعة.',
    signin: 'سجّل الدخول مجددًا لاستخدام هذه الدعوة.',
    rateLimit: 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.',
    offline: 'تعذّر الاتصال. تحقّق من اتصالك بالإنترنت وأعد المحاولة.',
    generic: 'تعذّر إكمال الطلب. حاول مرة أخرى.',
  },
  en: {
    title: 'Group invitation', join: 'Join group', request: 'Request to join', open: 'Open group',
    direct: 'Open membership', approval: 'Admin approval required', members: 'Members',
    loading: 'Loading invitation…', working: 'Processing request…', pending: 'Your request is waiting for a group admin’s approval.',
    refresh: 'Refresh request status', cancel: 'Cancel request', retry: 'Try again',
    username: 'Choose a username before joining this group.', usernameLabel: 'Username',
    usernameHint: 'Use 3–20 English letters or digits. You can use dots and underscores between them.',
    usernameInvalid: 'This username is invalid. Choose another one.', usernameTaken: 'This username is already taken.',
    displayName: 'Display name', saveProfile: 'Save profile', profileFailed: 'Could not save your profile. Try again.',
    expired: 'This invite link is invalid or has expired. Ask a group admin for a new link.',
    disabled: 'This invite link is disabled. Ask a group admin for a new link.',
    full: 'The group is full. Contact a group admin.',
    permission: 'You do not have permission to join this group. Contact a group admin.',
    signin: 'Sign in again to use this invitation.',
    rateLimit: 'Too many attempts. Wait a while and try again.',
    offline: 'Could not connect. Check your internet connection and try again.',
    generic: 'Could not complete the request. Try again.',
  },
};

function element(tag, className, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function action(text, run, primary = false) {
  const node = element('button', primary ? 'feature-button feature-primary' : 'feature-button', text);
  node.type = 'button';
  node.addEventListener('click', run);
  return node;
}

export function createGroupInviteView({
  getClient, getUser, getLocale, showDialog, closeDialog, openGroup, clearInvite, isCurrentInvite = () => true,
}) {
  function open(code) {
    const client = getClient();
    const user = getUser();
    if (!client || !user?.uid) return;
    const locale = getLocale() === 'en' ? 'en' : 'ar';
    const text = labels[locale];
    const content = element('section', 'group-invite');
    const summary = element('div', 'group-invite-summary');
    const notice = element('p', 'group-invite-notice');
    const actions = element('div', 'group-invite-actions');
    notice.setAttribute('role', 'status');
    notice.tabIndex = -1;
    content.append(summary, notice, actions);

    let preview;
    let busy = false;
    let problem;
    let profileProblem;
    let username = '';
    let displayName = user.displayName ?? '';
    const active = () => getUser() === user && isCurrentInvite(code) && content.isConnected && content.closest('dialog')?.open;

    function goToGroup() {
      if (!active()) return;
      closeDialog();
      clearInvite(code);
      openGroup(preview.conversationId);
    }

    function render() {
      const showGroup = preview && preview.status !== 'disabled';
      summary.hidden = !showGroup;
      summary.replaceChildren();
      if (showGroup) {
        const name = element('h3', 'group-invite-name', preview.groupName);
        name.dir = 'auto';
        const count = new Intl.NumberFormat(locale).format(preview.memberCount);
        const mode = preview.joinMode === 'approval_required' ? text.approval : text.direct;
        summary.append(name, element('p', 'group-invite-meta', `${text.members} · ${count} · ${mode}`));
      }

      const pending = preview?.status === 'request_pending';
      const message = busy ? (preview ? text.working : text.loading)
        : problem ? text[problem] : preview?.status === 'disabled' ? text.disabled : pending ? text.pending : '';
      notice.textContent = message;
      notice.hidden = !message;

      const actionFocused = actions.contains(document.activeElement);
      const restoreFocus = document.activeElement === notice;
      actions.replaceChildren();
      if (busy) {
        if (actionFocused) notice.focus();
        return;
      }
      if (problem === 'username') {
        actions.append(profileForm());
      } else if (problem) {
        if (['offline', 'rateLimit', 'generic'].includes(problem)) actions.append(action(text.retry, load, true));
      } else if (preview?.status === 'already_member') {
        actions.append(action(text.open, goToGroup, true));
      } else if (preview?.status === 'can_join') {
        actions.append(action(preview.joinMode === 'approval_required' ? text.request : text.join, join, true));
      } else if (pending) {
        actions.append(action(text.refresh, load), action(text.cancel, cancel));
      }
      if (restoreFocus) actions.querySelector('input, button')?.focus();
    }

    function profileForm() {
      const form = element('form', 'feature-form group-invite-profile');
      const usernameField = element('label', 'feature-field', text.usernameLabel);
      const handle = element('input', 'feature-input');
      handle.required = true;
      handle.minLength = USERNAME_MIN;
      handle.maxLength = USERNAME_MAX;
      handle.autocomplete = 'username';
      handle.autocapitalize = 'none';
      handle.spellcheck = false;
      handle.dir = 'ltr';
      handle.value = username;
      handle.setAttribute('aria-describedby', 'group-invite-username-hint');
      const hint = element('p', 'group-invite-meta', text.usernameHint);
      hint.id = 'group-invite-username-hint';
      usernameField.append(handle);
      form.append(usernameField, hint);

      let name;
      if (!user.displayName?.trim()) {
        const nameField = element('label', 'feature-field', text.displayName);
        name = element('input', 'feature-input');
        name.required = true;
        name.maxLength = 60;
        name.autocomplete = 'name';
        name.dir = 'auto';
        name.value = displayName;
        nameField.append(name);
        form.append(nameField);
      }

      if (profileProblem) {
        const error = element('p', 'group-invite-notice', text[profileProblem]);
        error.setAttribute('role', 'alert');
        form.append(error);
      }
      const submit = element('button', 'feature-button feature-primary', text.saveProfile);
      submit.type = 'submit';
      form.append(submit);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!active() || busy) return;
        username = handle.value;
        if (name) displayName = name.value;
        if (validateUsername(username) !== 'ok') {
          profileProblem = 'usernameInvalid';
          render();
          actions.querySelector('input')?.focus();
          return;
        }
        if (name && !displayName.trim()) {
          name.value = '';
          name.reportValidity();
          return;
        }
        profileProblem = undefined;
        void saveProfile();
      });
      return form;
    }

    async function perform(operation) {
      if (!active() || busy) return;
      busy = true;
      problem = undefined;
      render();
      try {
        await operation();
      } catch (error) {
        if (active()) problem = inviteProblem(error);
      } finally {
        if (active()) {
          busy = false;
          render();
        }
      }
    }

    async function readPreview() {
      const data = await client.call('resolveGroupInviteLink', { inviteCode: code });
      if (!active()) return;
      const id = data?.conversationId;
      const statuses = ['can_join', 'already_member', 'request_pending', 'disabled'];
      if (typeof id !== 'string' || !id || id === '.' || id === '..' || /[\/\\\x00-\x1f\x7f]/.test(id) || !statuses.includes(data.status)) {
        throw new Error('unexpected-invite-preview');
      }
      preview = data;
    }

    function load() {
      return perform(readPreview);
    }

    function saveProfile() {
      return perform(async () => {
        try {
          await client.completeInviteProfile({ username: normalizeUsername(username), displayName: displayName.trim() });
        } catch (error) {
          if (!active()) return;
          const code = error?.code?.replace?.(/^functions\//, '');
          problem = 'username';
          profileProblem = code === 'already-exists' ? 'usernameTaken'
            : code === 'invalid-argument' ? 'usernameInvalid' : 'profileFailed';
          return;
        }
        if (active()) await readPreview();
      });
    }

    function join() {
      return perform(async () => {
        const result = await client.call('joinGroupByInviteLink', { inviteCode: code });
        if (!active()) return;
        if (result?.conversationId !== preview.conversationId) throw new Error('unexpected-invite-result');
        if (result.status === 'joined' || result.status === 'already_member') goToGroup();
        else if (result.status === 'pending') preview = { ...preview, status: 'request_pending' };
        else throw new Error('unexpected-invite-result');
      });
    }

    function cancel() {
      return perform(async () => {
        await client.call('cancelMyJoinRequest', { conversationId: preview.conversationId });
        if (active()) await readPreview();
      });
    }

    showDialog(text.title, content);
    if (code) void load();
    else {
      problem = 'expired';
      render();
    }
  }

  return { open };
}
