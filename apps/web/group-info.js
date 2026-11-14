import { createGroupInfoActions } from './group-info-actions.js';
import { createGroupInfoInvite } from './group-info-invite.js';
import { createGroupInfoRoster } from './group-info-roster.js';

const copy = {
  en: { title: 'Group info', back: 'Back to conversation', member: 'member', members: 'members', locked: 'locked', disabled: 'disabled' },
  ar: { title: 'معلومات المجموعة', back: 'العودة إلى المحادثة', member: 'عضو', members: 'أعضاء', locked: 'مقفلة', disabled: 'معطّلة' },
};

function element(tag, className, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function backIcon() {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  const path = document.createElementNS(namespace, 'path');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', 'm15 18-6-6 6-6');
  svg.append(path);
  return svg;
}

export function createGroupInfo({ locale, uid, conversationId, client, call, getContext, isActive, showDialog, closeDialog,
  makeAvatar, formatTime, groupName, onWallpaper, onLeft, onOpenDirect, onBack }) {
  const text = copy[locale] ?? copy.en;
  const number = new Intl.NumberFormat(locale);
  const view = element('div', 'group-info-view');
  const header = element('header', 'group-info-header');
  const back = element('button', 'group-info-back');
  back.type = 'button';
  back.setAttribute('aria-label', text.back);
  back.append(backIcon());
  back.addEventListener('click', onBack);
  const heading = element('h2', '', text.title);
  heading.id = 'group-info-title';
  heading.tabIndex = -1;
  header.append(back, heading);
  const content = element('div', 'group-info-content');
  const hero = element('div', 'group-info-hero');
  const avatarSlot = element('div', 'group-info-avatar-slot');
  const name = element('h3', '');
  name.dir = 'auto';
  const count = element('p', '');
  const description = element('p', 'group-info-description');
  description.dir = 'auto';
  hero.append(avatarSlot, name, count, description);

  const context = { uid, conversationId, locale, client, call, isActive, showDialog, closeDialog, makeAvatar };
  const actions = createGroupInfoActions({ ...context, getContext, onWallpaper, onLeft });
  const roster = createGroupInfoRoster({ ...context, getRole: () => getContext()?.role, onOpenDirect });
  const invites = element('div', '');
  content.append(hero, actions.section, invites, roster.view);
  view.append(header, content);

  let invite;
  let lastName;
  let lastAvatar;
  let lastRole;
  let started = false;

  function update() {
    const current = getContext();
    if (!current) return;
    const { conversation, role } = current;
    const nextName = groupName(conversation);
    if (lastName !== nextName || lastAvatar !== conversation.avatarUrl) {
      const avatar = makeAvatar(nextName, conversation.avatarUrl);
      avatar.classList.add('group-info-avatar');
      avatarSlot.replaceChildren(avatar);
      name.textContent = nextName;
      lastName = nextName;
      lastAvatar = conversation.avatarUrl;
    }
    const members = conversation.memberCount ?? conversation.participantUids?.length ?? 0;
    const total = members + (conversation.externalMemberCount ?? 0);
    const status = ['locked', 'disabled'].includes(conversation.status) ? ` · ${text[conversation.status]}` : '';
    count.textContent = `${number.format(total)} ${total === 1 ? text.member : text.members}${status}`;
    description.textContent = conversation.description ?? '';
    description.hidden = !description.textContent;
    actions.update();
    if (lastRole !== role) {
      lastRole = role;
      roster.update();
    }
    const admin = role === 'owner' || role === 'admin';
    if (admin && !invite && started) {
      invite = createGroupInfoInvite({ ...context, groupName: nextName, formatTime,
        isActive: () => isActive() && ['owner', 'admin'].includes(getContext()?.role) });
      invites.append(invite.section);
      invite.start();
    } else if (!admin && invite) {
      closeDialog();
      invite.stop();
      invite = undefined;
      invites.replaceChildren();
    }
  }

  return {
    view, update,
    start() { started = true; update(); roster.start(); heading.focus(); },
    stop() { started = false; invite?.stop(); roster.dispose(); },
  };
}
