import { normalizePhoneToE164 } from '../mobile/src/lib/phone.ts';

const labels = {
  en: {
    actions: 'Actions', edit: 'Edit group info', add: 'Add members', lock: 'Lock group', unlock: 'Unlock group',
    wallpaper: 'Chat wallpaper', leave: 'Leave group', cancel: 'Cancel', save: 'Save changes',
    name: 'Group name', description: 'Description', photo: 'Group photo',
    photoFormat: 'Choose a JPEG, PNG, or WebP image under 5 MB.', nameRequired: 'Enter a group name.',
    username: 'Username', find: 'Find user', invite: 'Invite to group', found: 'Account found',
    invalidUsername: 'Enter a valid OfflineSMS username.', missingUser: 'No matching account was found.',
    memberExists: 'This account is already a group member.', noInvite: 'No new invitation was sent.', invited: 'Invitation sent.',
    phoneContact: 'Phone contact', contactName: 'Contact name', phoneNumber: 'Phone number',
    phoneHint: 'Include the country code.', addPhone: 'Add phone contact',
    badPhone: 'Enter a name and a valid international phone number.', addedPhone: 'Phone contact added.',
    contactExists: 'This contact is already in the group.',
    leaveConfirm: 'You won’t receive new messages from this group.',
    leaveOwner: 'Ownership will pass to another member and you won’t receive new messages from this group.',
    failed: 'Could not complete this action. Try again.', denied: 'You no longer have permission to do this.',
    locked: 'Group locked.', unlocked: 'Group unlocked.',
  },
  ar: {
    actions: 'الإجراءات', edit: 'تعديل معلومات المجموعة', add: 'إضافة أعضاء', lock: 'قفل المجموعة', unlock: 'فتح المجموعة',
    wallpaper: 'خلفية المحادثة', leave: 'مغادرة المجموعة', cancel: 'إلغاء', save: 'حفظ التغييرات',
    name: 'اسم المجموعة', description: 'الوصف', photo: 'صورة المجموعة',
    photoFormat: 'اختر صورة JPEG أو PNG أو WebP بحجم أقل من 5 ميغابايت.', nameRequired: 'أدخل اسم المجموعة.',
    username: 'اسم المستخدم', find: 'البحث عن مستخدم', invite: 'دعوة إلى المجموعة', found: 'عُثر على الحساب',
    invalidUsername: 'أدخل اسم مستخدم صالحًا في OfflineSMS.', missingUser: 'لم يُعثر على حساب مطابق.',
    memberExists: 'هذا الحساب عضو في المجموعة بالفعل.', noInvite: 'لم تُرسل دعوة جديدة.', invited: 'أُرسلت الدعوة.',
    phoneContact: 'جهة اتصال هاتفية', contactName: 'اسم جهة الاتصال', phoneNumber: 'رقم الهاتف',
    phoneHint: 'أدخل الرقم مع رمز الدولة.', addPhone: 'إضافة جهة اتصال هاتفية',
    badPhone: 'أدخل اسمًا ورقم هاتف دوليًا صالحًا.', addedPhone: 'أُضيفت جهة الاتصال.',
    contactExists: 'جهة الاتصال موجودة في المجموعة بالفعل.',
    leaveConfirm: 'لن تتلقى رسائل جديدة من هذه المجموعة.',
    leaveOwner: 'ستنتقل ملكية المجموعة إلى عضو آخر، ولن تتلقى رسائل جديدة منها.',
    failed: 'تعذّر إكمال الإجراء. حاول مرة أخرى.', denied: 'لم تعد لديك صلاحية تنفيذ هذا الإجراء.',
    locked: 'قُفلت المجموعة.', unlocked: 'فُتحت المجموعة.',
  },
};

const adminRoles = new Set(['owner', 'admin']);
const memberRoles = new Set(['owner', 'admin', 'member']);
const unavailable = new Set(['disabled', 'archived', 'deleted']);
const avatarTypes = ['image/jpeg', 'image/png', 'image/webp'];

function element(tag, className = '', value = '') {
  const result = document.createElement(tag);
  result.className = className;
  result.textContent = value;
  return result;
}

function button(value, className, click) {
  const result = element('button', className, value);
  result.type = 'button';
  if (click) result.addEventListener('click', click);
  return result;
}

function field(text, input) {
  const label = element('label', 'feature-field', text);
  label.append(input);
  return label;
}

function inputValue(type, value = '') {
  const input = element('input', 'feature-input');
  input.type = type;
  input.value = value;
  return input;
}

function feedback() {
  const note = element('p', 'dialog-note');
  note.hidden = true;
  note.setAttribute('role', 'status');
  return note;
}

function setFeedback(note, value = '', failed = false) {
  note.textContent = value;
  note.hidden = !value;
  note.classList.toggle('chat-tool-error', failed);
}

function detailForm(text) {
  const form = element('form', 'feature-form');
  const submit = button(text, 'feature-button feature-primary');
  submit.type = 'submit';
  return { form, submit, note: feedback() };
}

export function createGroupInfoActions({ locale, client, call, getContext, isActive, showDialog, closeDialog, onWallpaper, onLeft }) {
  const t = labels[locale] ?? labels.en;
  const section = element('section', 'group-info-section');
  const note = feedback();
  note.classList.add('group-info-note');
  let locking = false;

  function check(context, { admin = false, available = false, content } = {}) {
    if (!isActive() || !context) return false;
    const current = getContext();
    return Boolean(current?.uid === context.uid && current?.conversation?.id === context.conversation.id
      && (admin ? adminRoles.has(current.role) : memberRoles.has(current.role))
      && (!available || !unavailable.has(current.conversation.status))
      && (!content || content.closest('dialog[open]')));
  }

  function fail(error) {
    return String(error?.code).endsWith('permission-denied') ? t.denied : t.failed;
  }

  function row(label, run, danger = false) {
    const result = button(label, `group-info-row${danger ? ' group-info-danger' : ''}`, run);
    if (!danger) {
      const chevron = element('span', 'group-info-chevron', '›');
      chevron.setAttribute('aria-hidden', 'true');
      result.append(chevron);
    }
    return result;
  }

  function editGroup() {
    const context = getContext();
    if (!check(context, { admin: true })) return;
    const { conversation } = context;
    const { form, submit, note } = detailForm(t.save);
    const name = inputValue('text', conversation.name ?? '');
    name.required = true;
    name.dir = 'auto';
    name.maxLength = 80;
    const description = element('textarea', 'feature-input');
    description.dir = 'auto';
    description.rows = 4;
    description.maxLength = 500;
    description.value = conversation.description ?? '';
    const photo = inputValue('file');
    photo.accept = avatarTypes.join(',');
    const valid = () => check(context, { admin: true, content: form });
    let uploaded;

    form.append(field(t.name, name), field(t.description, description), field(t.photo, photo),
      element('p', 'dialog-note', t.photoFormat), submit, note);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!valid() || submit.disabled) return;
      const groupName = name.value.trim();
      const groupDescription = description.value.trim() || null;
      const file = photo.files?.[0];
      if (!groupName || groupName.length > name.maxLength || (groupDescription?.length ?? 0) > description.maxLength) {
        setFeedback(note, groupName ? t.failed : t.nameRequired, true);
        return;
      }
      if (file && (!avatarTypes.includes(file.type) || !file.size || file.size >= 5 * 1024 * 1024)) {
        setFeedback(note, t.photoFormat, true);
        return;
      }
      submit.disabled = name.disabled = description.disabled = photo.disabled = true;
      setFeedback(note);
      try {
        const patch = { conversationId: conversation.id };
        if (groupName !== (conversation.name ?? '').trim()) patch.name = groupName;
        if (groupDescription !== (conversation.description?.trim() || null)) patch.description = groupDescription;
        if (file) {
          if (uploaded?.file !== file) uploaded = { file, url: await client.uploadGroupAvatar(conversation.id, file) };
          if (!valid()) return;
          patch.avatarUrl = uploaded.url;
        }
        if (Object.keys(patch).length > 1) await call('updateGroupInfo', patch);
        if (valid()) closeDialog();
      } catch (error) {
        if (valid()) setFeedback(note, fail(error), true);
      } finally {
        if (form.isConnected) submit.disabled = name.disabled = description.disabled = photo.disabled = false;
      }
    });
    showDialog(t.edit, form);
    name.focus();
  }

  function addMembers() {
    const context = getContext();
    if (!check(context, { admin: true, available: true })) return;
    const conversationId = context.conversation.id;
    const content = element('div', 'chat-tool-stack');
    const valid = () => check(context, { admin: true, available: true, content });
    const { form, submit, note } = detailForm(t.find);
    const username = inputValue('text');
    username.required = true;
    username.maxLength = 21;
    username.dir = 'ltr';
    username.autocomplete = 'off';
    username.placeholder = '@username';
    const matchRow = element('div', 'feature-form');
    username.addEventListener('input', () => matchRow.replaceChildren());
    form.append(field(t.username, username), submit, note, matchRow);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!valid() || submit.disabled) return;
      matchRow.replaceChildren();
      setFeedback(note);
      submit.disabled = username.disabled = true;
      try {
        const profile = await client.findByUsername(username.value);
        if (!valid()) return;
        if (!profile) { setFeedback(note, t.missingUser); return; }
        const alreadyMember = () => getContext().conversation.participantUids?.includes(profile.uid) || profile.uid === context.uid;
        if (alreadyMember()) { setFeedback(note, t.memberExists); return; }
        const name = element('p', '', profile.displayName || profile.username || t.found);
        name.dir = 'auto';
        const invite = button(t.invite, 'feature-button feature-primary', async () => {
          if (!valid() || invite.disabled) return;
          if (alreadyMember()) { setFeedback(note, t.memberExists); return; }
          invite.disabled = submit.disabled = username.disabled = true;
          setFeedback(note);
          try {
            const result = await call('addMembers', { conversationId, memberUids: [profile.uid] });
            if (!valid()) return;
            setFeedback(note, (result?.invited ?? result?.added) > 0 ? t.invited : t.noInvite);
            matchRow.replaceChildren();
          } catch (error) {
            if (valid()) setFeedback(note, fail(error), true);
          } finally {
            if (content.isConnected) invite.disabled = submit.disabled = username.disabled = false;
          }
        });
        matchRow.append(name, invite);
      } catch (error) {
        if (valid()) setFeedback(note, error?.code === 'username-invalid' ? t.invalidUsername : fail(error), true);
      } finally {
        if (content.isConnected) submit.disabled = username.disabled = false;
      }
    });

    const phoneForm = detailForm(t.addPhone);
    const contactName = inputValue('text');
    contactName.required = true;
    contactName.maxLength = 80;
    contactName.dir = 'auto';
    const phone = inputValue('tel');
    phone.required = true;
    phone.maxLength = 35;
    phone.dir = 'ltr';
    phone.placeholder = '+970…';
    phoneForm.form.append(field(t.contactName, contactName), field(t.phoneNumber, phone),
      element('p', 'dialog-note', t.phoneHint), phoneForm.submit, phoneForm.note);
    phoneForm.form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!valid() || phoneForm.submit.disabled) return;
      const displayName = contactName.value.trim();
      const phoneNumber = /^[+0-9().\s-]+$/.test(phone.value) && normalizePhoneToE164(phone.value);
      if (!displayName || displayName.length > contactName.maxLength || !phoneNumber) {
        setFeedback(phoneForm.note, t.badPhone, true);
        return;
      }
      phoneForm.submit.disabled = contactName.disabled = phone.disabled = true;
      setFeedback(phoneForm.note);
      try {
        const result = await call('addExternalContactToGroup', { conversationId, displayName, phoneNumber });
        if (!valid()) return;
        setFeedback(phoneForm.note, result?.added > 0 ? t.addedPhone : t.contactExists);
        if (result?.added > 0) contactName.value = phone.value = '';
      } catch (error) {
        if (valid()) setFeedback(phoneForm.note, fail(error), true);
      } finally {
        if (content.isConnected) phoneForm.submit.disabled = contactName.disabled = phone.disabled = false;
      }
    });

    content.append(form, element('h3', '', t.phoneContact), phoneForm.form);
    showDialog(t.add, content);
    username.focus();
  }

  async function toggleLock() {
    const context = getContext();
    if (locking || !check(context, { admin: true, available: true })) return;
    const locked = context.conversation.status !== 'locked';
    locking = true;
    setFeedback(note);
    update();
    try {
      await call('lockGroup', { conversationId: context.conversation.id, locked });
      if (check(context, { admin: true })) setFeedback(note, locked ? t.locked : t.unlocked);
    } catch (error) {
      if (check(context, { admin: true })) setFeedback(note, fail(error), true);
    } finally {
      locking = false;
      if (isActive()) update();
    }
  }

  function leaveGroup() {
    const context = getContext();
    if (!check(context)) return;
    const content = element('div', 'chat-tool-stack');
    const { conversation, role, uid } = context;
    const valid = () => check(context, { content });
    const otherMembers = (conversation.memberCount ?? conversation.participantUids?.length ?? 0) > 1;
    const help = element('p', 'dialog-note', role === 'owner' && otherMembers ? t.leaveOwner : t.leaveConfirm);
    const error = feedback();
    const controls = element('div', 'feature-toolbar');
    const cancel = button(t.cancel, 'feature-button', closeDialog);
    const confirm = button(t.leave, 'feature-button chat-tool-button danger', async () => {
      if (!valid() || confirm.disabled) return;
      confirm.disabled = cancel.disabled = true;
      setFeedback(error);
      try {
        await call('leaveGroup', { conversationId: conversation.id });
        if (valid()) closeDialog();
        onLeft(conversation.id, uid);
      } catch (failure) {
        if (valid()) setFeedback(error, fail(failure), true);
      } finally {
        if (content.isConnected) confirm.disabled = cancel.disabled = false;
      }
    });
    controls.append(cancel, confirm);
    content.append(help, error, controls);
    showDialog(t.leave, content);
    cancel.focus();
  }

  const edit = row(t.edit, editGroup);
  const add = row(t.add, addMembers);
  const lock = row(t.lock, toggleLock);
  const wallpaper = row(t.wallpaper, () => { if (check(getContext())) onWallpaper(); });
  const leave = row(t.leave, leaveGroup, true);
  section.append(element('h3', 'group-info-section-title', t.actions), edit, add, lock, wallpaper, leave, note);

  function update() {
    const context = getContext();
    const role = context?.role;
    section.hidden = !memberRoles.has(role);
    edit.hidden = add.hidden = lock.hidden = !adminRoles.has(role);
    const status = context?.conversation?.status;
    add.disabled = unavailable.has(status);
    lock.disabled = locking || unavailable.has(status);
    lock.firstChild.textContent = status === 'locked' ? t.unlock : t.lock;
  }

  return { section, update };
}
