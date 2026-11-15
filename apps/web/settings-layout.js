import { settings as ar } from '../mobile/src/i18n/ar.json';
import { settings as en } from '../mobile/src/i18n/en.json';

export const settingsLabels = { ar, en };

const chips = {
  findFriends: ['#176cad', 'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm11-6v8m-4-4h8'],
  email: ['#5060ba', 'M3 5h18v14H3zM3 7l9 6 9-6'],
  phone: ['#067e72', 'M5 3h4l2 5-3 2a14 14 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A18 18 0 0 1 3 5a2 2 0 0 1 2-2Z'],
  securityPin: ['#2e7e42', 'M14 3a6 6 0 0 0-5.4 8.6L3 17.2V21h4v-3h3l2.4-2.4A6 6 0 1 0 14 3Zm3 6h.01'],
  permissions: ['#a45800', 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm-3-10 2 2 4-4'],
  points: ['#936500', 'm12 2 3 6.3 7 .9-5 5 1.2 7-6.2-3.4-6.2 3.4L7 14.2l-5-5 7-.9z'],
  smsReminders: ['#b91953', 'M3 4h18v13H9l-6 4zM7 10h.01M12 10h.01M17 10h.01'],
  inAppNotifs: ['#bd382c', 'M19 17H5l2-3V9a5 5 0 0 1 10 0v5l2 3Zm-9 3h4'],
  wallpaper: ['#007b8c', 'M3 3h18v18H3zM3 17l5-5 4 4 3-3 6 6M15 8h.01'],
  notifs: ['#bd382c', 'M19 17H5l2-3V9a5 5 0 0 1 10 0v5l2 3Zm-9 3h4'],
  devices: ['#4350a0', 'M5 4h14v12H5zM5 16l-3 4h20l-3-4'],
  support: ['#176cad', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM9 9a3 3 0 1 1 4 2.8c-1 .4-1 1.2-1 2.2m0 3h.01'],
  privacyPolicy: ['#2e7e42', 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm-3-10 2 2 4-4'],
  terms: ['#785348', 'M5 3h9l5 5v13H5zM14 3v5h5M8 12h8m-8 4h8'],
  deleteAcct: ['#a82024', 'M3 6h18m-15 0 1 15h10l1-15M9 6V3h6v3M10 10v7m4-7v7'],
  version: ['#526d78', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-12v6m0-9h.01'],
  signOut: ['#bd382c', 'M9 4H3v16h6m5-12 4 4-4 4m4-4H8'],
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function createSettingsLayout({ outlineIcon, avatar }) {
  function row({ label, icon, description, onClick, control, danger, trailing, href }) {
    const tag = control ? 'label' : href ? 'a' : onClick ? 'button' : 'div';
    const item = element(tag, control ? 'feature-toggle settings-row' : 'feature-list-button settings-row');
    if (danger) item.classList.add('settings-danger');
    if (tag === 'button') {
      item.type = 'button';
      item.addEventListener('click', onClick);
    }
    if (href) {
      item.href = href;
      item.target = '_blank';
      item.rel = 'noopener noreferrer';
    }
    if (chips[icon]) {
      const [color, path] = chips[icon];
      const chip = element('span', 'feature-settings-chip');
      chip.style.backgroundColor = color;
      chip.append(outlineIcon(path));
      item.append(chip);
    }
    const copy = element('span', 'feature-list-copy');
    const subtitle = element('small', 'settings-row-description');
    if (description) subtitle.append(description);
    copy.append(element('strong', '', label), subtitle);
    item.append(copy);
    if (control) item.append(control);
    else if (trailing) item.append(element('span', 'settings-trailing', trailing));
    else if (!danger && (onClick || href)) item.append(outlineIcon('m14 6-6 6 6 6'));
    return item;
  }

  function card(...rows) {
    const group = element('div', 'feature-settings-card');
    group.append(...rows);
    return group;
  }

  function profileHeader(label, hint, edit) {
    const header = element('button', 'feature-settings-profile');
    header.type = 'button';
    header.setAttribute('aria-label', label);
    header.addEventListener('click', edit);
    const portrait = element('span', 'feature-settings-portrait');
    const camera = element('span', 'feature-settings-camera');
    camera.append(outlineIcon('M3 6h4l2-3h6l2 3h4v14H3zM15 13a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z'));
    const name = element('strong');
    name.dir = 'auto';
    const subtitle = element('small');
    subtitle.dir = 'auto';
    header.append(portrait, name, subtitle);
    return { element: header, update(profile) {
      const displayName = profile.displayName || label;
      if (name.textContent !== displayName || portrait.dataset.photo !== (profile.photoURL ?? '')) {
        name.textContent = displayName;
        portrait.dataset.photo = profile.photoURL ?? '';
        portrait.replaceChildren(avatar(displayName, profile.photoURL), camera);
      }
      subtitle.textContent = [profile.phoneNumber, profile.username ? '@' + profile.username : ''].filter(Boolean).join(' · ') || hint;
    } };
  }

  function options(title, values, selected, save, onError, isActive) {
    const section = element('section', 'feature-choice');
    const controls = element('div', 'feature-toolbar');
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', title);
    for (const [value, label] of values) {
      const option = element('button', 'feature-button', label);
      option.type = 'button';
      option.value = value;
      option.addEventListener('click', async () => {
        if (option.getAttribute('aria-pressed') === 'true') return;
        for (const node of controls.children) node.disabled = true;
        try {
          await save(value);
          if (isActive()) update(value);
        } catch {
          if (isActive()) onError();
        } finally {
          for (const node of controls.children) node.disabled = false;
        }
      });
      controls.append(option);
    }
    function update(value) {
      for (const node of controls.children) node.setAttribute('aria-pressed', String(value === node.value));
    }
    update(selected);
    section.append(element('strong', '', title), controls);
    return { element: section, update };
  }

  return { row, card, profileHeader, options };
}
