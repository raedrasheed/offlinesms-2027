import { displayNameFor, looksLikeUid } from '../mobile/src/lib/displayNames.pure.ts';
import { maskPhone } from '../mobile/src/lib/phone.ts';

const copy = {
  en: {
    members: 'Members', phoneContacts: 'Phone contacts', loading: 'Loading members…', unavailable: 'Could not load members.',
    contactsUnavailable: 'Could not load phone contacts.', retry: 'Try again', empty: 'No members to show.',
    unknown: 'Unknown user', phoneContact: 'Phone contact', you: 'you', registered: 'On OfflineSMS', sms: 'SMS only',
    owner: 'Owner', admin: 'Admin', message: 'Message', promote: 'Make group admin', demote: 'Remove admin permission',
    remove: 'Remove from group', removeContact: 'Remove contact', cancel: 'Cancel', change: 'Confirm',
    confirmPromote: (name) => `Make ${name} a group admin?`,
    confirmDemote: (name) => `Remove ${name}’s admin permission?`,
    confirmRemove: (name) => `Remove ${name} from this group?`,
    permission: 'You do not have permission to perform this action.', actionFailed: 'Could not complete the action. Try again.',
  },
  ar: {
    members: 'الأعضاء', phoneContacts: 'جهات الاتصال الهاتفية', loading: 'جارٍ تحميل الأعضاء…', unavailable: 'تعذّر تحميل الأعضاء.',
    contactsUnavailable: 'تعذّر تحميل جهات الاتصال الهاتفية.', retry: 'إعادة المحاولة', empty: 'لا يوجد أعضاء للعرض.',
    unknown: 'مستخدم غير معروف', phoneContact: 'جهة اتصال هاتفية', you: 'أنت', registered: 'على OfflineSMS', sms: 'رسائل SMS فقط',
    owner: 'المالك', admin: 'مشرف', message: 'مراسلة', promote: 'تعيين مشرفًا للمجموعة', demote: 'إزالة صلاحية الإشراف',
    remove: 'إزالة من المجموعة', removeContact: 'إزالة جهة الاتصال', cancel: 'إلغاء', change: 'تأكيد',
    confirmPromote: (name) => `هل تريد تعيين ${name} مشرفًا للمجموعة؟`,
    confirmDemote: (name) => `هل تريد إزالة صلاحية الإشراف عن ${name}؟`,
    confirmRemove: (name) => `هل تريد إزالة ${name} من المجموعة؟`,
    permission: 'ليس لديك إذن لتنفيذ هذا الإجراء.', actionFailed: 'تعذّر تنفيذ الإجراء. حاول مرة أخرى.',
  },
};

function node(tag, className, text = '') {
  const item = document.createElement(tag);
  item.className = className;
  item.textContent = text;
  return item;
}

function action(className, title, run) {
  const button = node('button', className, title);
  button.type = 'button';
  button.addEventListener('click', run);
  return button;
}

export function createGroupInfoRoster({ uid, conversationId, locale, client, call, makeAvatar, onOpenDirect,
  showDialog, closeDialog, isActive, getRole }) {
  const text = copy[locale] ?? copy.en;
  const number = new Intl.NumberFormat(locale);
  const compareNames = new Intl.Collator(locale, { usage: 'sort', sensitivity: 'base', numeric: true, ignorePunctuation: true }).compare;
  const view = node('div', 'group-info-roster');
  const memberSection = node('section', 'group-info-section');
  const externalSection = node('section', 'group-info-section');
  view.append(memberSection, externalSection);
  const profiles = new Map();
  const loadedProfiles = new Set();
  let members;
  let externals;
  let stopMembers;
  let stopExternals;
  let memberRevision = 0;
  let externalRevision = 0;
  let memberError = false;
  let externalError = false;
  let disposed = false;
  let busy = false;
  const active = () => !disposed && view.isConnected && isActive();
  const admin = () => ['owner', 'admin'].includes(getRole());
  let wasAdmin = admin();

  function nameFor(member) {
    const profile = profiles.get(member.uid);
    const validProfile = profile && !looksLikeUid(profile.displayName, member.uid)
      ? profile : { ...profile, displayName: null };
    return displayNameFor(validProfile, { uid: member.uid, snapshot: member.displayNameSnapshot, fallback: text.unknown });
  }

  function displayControls(dialog, onSuccess, callName, args, canAct) {
    return async () => {
      if (!active() || !dialog.isConnected || !dialog.closest('dialog')?.open || busy || !canAct()) return;
      busy = true;
      const controls = [...dialog.querySelectorAll('button')];
      const feedback = dialog.querySelector('.group-info-note');
      controls.forEach(button => { button.disabled = true; });
      feedback.hidden = true;
      try {
        const result = await call(callName, args);
        if (active() && dialog.isConnected && dialog.closest('dialog')?.open) onSuccess(result);
      } catch (error) {
        if (!active() || !dialog.isConnected) return;
        feedback.hidden = false;
        feedback.textContent = error?.code?.split('/').pop() === 'permission-denied' ? text.permission : text.actionFailed;
      } finally {
        busy = false;
        if (active() && dialog.isConnected) controls.forEach(button => { button.disabled = false; });
      }
    };
  }

  function menuContent() {
    const dialog = node('div', 'group-info-member-actions');
    const feedback = node('p', 'group-info-note');
    feedback.setAttribute('role', 'alert');
    feedback.hidden = true;
    dialog.append(feedback);
    return dialog;
  }

  function confirm({ title, question, callName, args, canAct }, back) {
    if (!active() || !canAct()) return;
    const dialog = menuContent();
    dialog.prepend(node('p', 'dialog-note', question));
    dialog.append(action('dialog-action', title, displayControls(dialog, () => closeDialog(), callName, args, canAct)),
      action('dialog-action', text.cancel, back || closeDialog));
    showDialog(title, dialog);
  }

  function memberMenu(member) {
    const find = () => members?.find(item => item.uid === member.uid);
    if (!active() || !find() || member.uid === uid) return;
    const dialog = menuContent();
    const name = nameFor(member);
    const canManage = () => {
      const target = find();
      return admin() && Boolean(target && target.role !== 'owner');
    };
    const canMessage = () => Boolean(find());
    dialog.append(action('dialog-action', text.message, displayControls(dialog, (result) => {
      if (typeof result?.conversationId !== 'string' || !result.conversationId) throw new Error('missing-conversation');
      closeDialog();
      onOpenDirect(result.conversationId);
    }, 'getOrCreateDirectConversation', { otherUserId: member.uid }, canMessage)));
    if (canManage()) {
      const role = member.role === 'admin' ? 'member' : 'admin';
      const roleLabel = role === 'admin' ? text.promote : text.demote;
      const args = { conversationId, memberUid: member.uid };
      const back = () => { const target = find(); if (target) memberMenu(target); else closeDialog(); };
      dialog.append(action('dialog-action', roleLabel, () => confirm({ title: roleLabel,
        question: (role === 'admin' ? text.confirmPromote : text.confirmDemote)(name), callName: 'changeRole',
        args: { ...args, role }, canAct: () => canManage() && find().role !== role }, back)));
      dialog.append(action('dialog-action', text.remove, () => confirm({ title: text.remove,
        question: text.confirmRemove(name), callName: 'removeMember', args, canAct: canManage }, back)));
    }
    dialog.append(action('dialog-action', text.cancel, closeDialog));
    showDialog(name, dialog);
  }

  function removeContact(contact, name) {
    confirm({ title: text.removeContact, question: text.confirmRemove(name), callName: 'removeExternalContactFromGroup',
      args: { conversationId, contactId: contact.contactId },
      canAct: () => admin() && Boolean(externals?.some(item => item.contactId === contact.contactId)) });
  }

  function rosterRow(name, { photo, registered, role, subtitle, handler, self = false } = {}) {
    const item = node('li', '');
    const row = handler ? action('group-info-member', '', handler) : node('div', 'group-info-member');
    const avatar = node('span', 'group-info-member-avatar');
    const initial = Array.from(name.replace(/^@/, ''))[0] || '?';
    avatar.append(makeAvatar(initial, photo));
    if (registered) {
      const badge = node('img', 'group-info-registered');
      badge.src = './logo.png';
      badge.alt = '';
      badge.setAttribute('aria-hidden', 'true');
      avatar.append(badge);
    }
    const label = node('span', 'group-info-member-copy');
    const visibleName = node('strong', '');
    const actualName = node('bdi', '', name);
    visibleName.append(actualName);
    if (self) visibleName.append(` (${text.you})`);
    label.append(visibleName);
    if (subtitle) label.append(node('small', '', subtitle));
    row.append(avatar, label);
    if (role === 'owner' || role === 'admin') {
      const badge = node('span', 'group-info-member-badge', text[role]);
      badge.dataset.role = role;
      row.append(badge);
    }
    item.append(row);
    return item;
  }

  function renderSection(section, title, rows, error, retry, empty) {
    section.replaceChildren(node('h3', 'group-info-section-title', rows ? `${title} (${number.format(rows.length)})` : title));
    if (!rows || !rows.length) {
      const note = node('p', 'group-info-note', error || (rows ? empty : text.loading));
      note.setAttribute('role', error ? 'alert' : 'status');
      section.append(note);
      if (error) section.append(action('feature-button', text.retry, retry));
      return;
    }
    const list = node('ul', 'group-info-member-list');
    for (const row of rows) list.append(row);
    section.append(list);
  }

  function render() {
    if (!active()) return;
    wasAdmin = admin();
    const ordered = members?.map((member) => ({ member, name: nameFor(member) }))
      .sort((a, b) => compareNames(a.name, b.name) || a.member.uid.localeCompare(b.member.uid));
    renderSection(memberSection, text.members, ordered?.map(({ member, name }) => {
      const self = member.uid === uid;
      return rosterRow(name, { photo: profiles.get(member.uid)?.photoURL || member.photoURLSnapshot,
        role: member.role, self, registered: true, handler: self ? null : () => memberMenu(member) });
    }), memberError ? text.unavailable : '', watchMembers, text.empty);

    externalSection.hidden = !externalError && !externals?.length;
    if (externalSection.hidden) {
      externalSection.replaceChildren();
      return;
    }
    const orderedExternals = externals?.map(contact => ({ contact,
      name: (typeof contact.displayName === 'string' && contact.displayName.trim()) || text.phoneContact }))
      .sort((a, b) => compareNames(a.name, b.name) || a.contact.contactId.localeCompare(b.contact.contactId));
    renderSection(externalSection, text.phoneContacts, orderedExternals?.map(({ contact, name }) => {
      const registered = contact.isRegistered === true;
      const phone = maskPhone(typeof contact.phoneE164 === 'string' ? contact.phoneE164 : '');
      return rosterRow(name, { registered, subtitle: `${phone} · ${registered ? text.registered : text.sms}`,
        handler: wasAdmin ? () => removeContact(contact, name) : null });
    }), externalError ? text.contactsUnavailable : '', watchExternals, '');
  }

  function watchMembers() {
    if (!active()) return;
    stopMembers?.();
    const revision = ++memberRevision;
    memberError = false;
    members = undefined;
    render();
    stopMembers = client.watchGroupMembers(uid, conversationId, (rows) => {
      if (!active() || revision !== memberRevision) return;
      members = rows.filter(member => typeof member.uid === 'string' && (member.status ?? 'active') === 'active');
      render();
      if (!client.getGroupMemberProfiles) return;
      const missing = members.map(member => member.uid).filter(id => !loadedProfiles.has(id));
      if (!missing.length) return;
      missing.forEach(id => loadedProfiles.add(id));
      client.getGroupMemberProfiles(uid, missing).then((rows) => {
        if (!active()) return;
        rows.forEach(profile => { profiles.set(profile.uid, profile); });
        render();
      }).catch(() => { missing.forEach(id => loadedProfiles.delete(id)); });
    }, () => {
      if (!active() || revision !== memberRevision) return;
      members = undefined;
      memberError = true;
      render();
    });
  }

  function watchExternals() {
    if (!active()) return;
    stopExternals?.();
    const revision = ++externalRevision;
    externalError = false;
    externals = undefined;
    render();
    stopExternals = client.watchGroupExternalMembers(uid, conversationId, (rows) => {
      if (!active() || revision !== externalRevision) return;
      externals = rows.filter(contact => typeof contact.contactId === 'string');
      render();
    }, () => {
      if (!active() || revision !== externalRevision) return;
      externals = undefined;
      externalError = true;
      render();
    });
  }

  return {
    view, start() { watchMembers(); watchExternals(); },
    update() { if (wasAdmin !== admin()) render(); },
    dispose() {
      disposed = true;
      stopMembers?.();
      stopExternals?.();
    },
  };
}
