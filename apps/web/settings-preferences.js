import { normalizeAccountAlertPreferences, normalizeNotificationPreferences } from './settings-preferences-client.js';
import { browserPermissionStatus, requestBrowserPermission } from './settings-browser-permissions.js';

export { showConnectedBrowserNotification } from './settings-browser-permissions.js';

const words = {
  en: {
    permissions: 'Permissions',
    smsReminders: 'Allow important SMS reminders',
    smsOn: 'OfflineSMS may send you SMS reminders for important messages.',
    smsOff: 'You won’t receive SMS reminders from OfflineSMS.',
    inApp: 'In-app notifications',
    inAppDetail: 'Show alerts for new messages and activity.',
    notifications: 'Notifications',
    notificationDetail: 'Preferences apply across your account. Browser notifications require an open OfflineSMS Web tab.',
    enabled: 'Enable notifications',
    enabledDetail: 'Master switch for all push notifications.',
    directMessages: 'Direct messages',
    groupMessages: 'Group messages',
    reactions: 'Reactions',
    sound: 'Sound',
    vibration: 'Vibration',
    showPreview: 'Show message preview',
    showPreviewDetail: 'When off, notifications hide the message text.',
    loading: 'Loading settings…',
    loadFailed: 'Couldn’t load notification settings.',
    retry: 'Try again',
    saveFailed: 'Couldn’t update setting. Please try again.',
    permissionsDetail: 'Manage access for this browser. Use the site settings beside the address bar to change a saved permission.',
    contacts: 'Contacts',
    contactsDetail: 'Choose contacts when using Find friends.',
    contactsUnavailable: 'Search by username or phone number in Find friends.',
    notificationsDetail: 'Allow alerts in this browser.',
    camera: 'Camera',
    cameraDetail: 'Take photos when attaching them to messages.',
    microphone: 'Microphone',
    microphoneDetail: 'Allow microphone access in this browser.',
    'per-use': 'Ask each time',
    granted: 'Allowed',
    denied: 'Blocked',
    prompt: 'Not yet granted',
    unsupported: 'Unavailable on this browser',
    'no-device': 'Device unavailable',
    requestFailed: 'Couldn’t access this device. Check your browser and device settings.',
    manage: 'How to change',
    grant: 'Allow',
    find: 'Find friends',
  },
  ar: {
    permissions: 'الأذونات',
    smsReminders: 'السماح بتذكيرات SMS المهمة',
    smsOn: 'قد يرسل OfflineSMS تذكيرات SMS للرسائل المهمة.',
    smsOff: 'لن تتلقى تذكيرات SMS من OfflineSMS.',
    inApp: 'الإشعارات داخل التطبيق',
    inAppDetail: 'عرض تنبيهات للرسائل الجديدة والأنشطة.',
    notifications: 'الإشعارات',
    notificationDetail: 'تنطبق التفضيلات على حسابك. تعمل إشعارات المتصفح أثناء بقاء تبويب OfflineSMS Web مفتوحًا.',
    enabled: 'تفعيل الإشعارات',
    enabledDetail: 'التحكم بجميع الإشعارات الفورية.',
    directMessages: 'الرسائل المباشرة',
    groupMessages: 'رسائل المجموعات',
    reactions: 'التفاعلات',
    sound: 'الصوت',
    vibration: 'الاهتزاز',
    showPreview: 'إظهار معاينة الرسالة',
    showPreviewDetail: 'عند الإيقاف، يُخفى نص الرسالة من الإشعار.',
    loading: 'جارٍ تحميل الإعدادات…',
    loadFailed: 'تعذّر تحميل إعدادات الإشعارات.',
    retry: 'إعادة المحاولة',
    saveFailed: 'تعذّر تحديث الإعداد. يرجى المحاولة مرة أخرى.',
    permissionsDetail: 'أدر الأذونات في هذا المتصفح. لتغيير إذن محفوظ، افتح إعدادات الموقع بجوار شريط العنوان.',
    contacts: 'جهات الاتصال',
    contactsDetail: 'اختر جهات الاتصال عند البحث عن الأصدقاء.',
    contactsUnavailable: 'ابحث باسم المستخدم أو رقم الهاتف في البحث عن الأصدقاء.',
    notificationsDetail: 'السماح بالتنبيهات في هذا المتصفح.',
    camera: 'الكاميرا',
    cameraDetail: 'التقاط صور لإرفاقها بالرسائل.',
    microphone: 'الميكروفون',
    microphoneDetail: 'السماح باستخدام الميكروفون في هذا المتصفح.',
    'per-use': 'طلب الإذن كل مرة',
    granted: 'مسموح',
    denied: 'محظور',
    prompt: 'لم يُمنح بعد',
    unsupported: 'غير متاح في هذا المتصفح',
    'no-device': 'الجهاز غير متاح',
    requestFailed: 'تعذّر الوصول إلى هذا الجهاز. تحقّق من إعدادات المتصفح والجهاز.',
    manage: 'طريقة التغيير',
    grant: 'السماح',
    find: 'البحث عن الأصدقاء',
  },
};

const notificationKeys = ['enabled', 'directMessages', 'groupMessages', 'reactions', 'sound', 'vibration', 'showPreview'];

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function action(text, onClick) {
  const button = node('button', 'feature-button', text);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function toggle(label) {
  const input = node('input', 'settings-pref-switch');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.setAttribute('aria-label', label);
  return input;
}

function settingDetail(label, description, control) {
  const element = node('div', 'settings-pref-detail');
  const copy = node('div', 'settings-pref-copy');
  copy.append(node('strong', '', label));
  const help = node('small', '', description);
  help.hidden = !description;
  copy.append(help);
  element.append(copy, control);
  return { element, help };
}

export function createSettingsPreferences({
  locale, client, user, row, showDialog, closeDialog, isActive, announce, openFindFriends,
}) {
  const text = words[locale] ?? words.en;
  let account = normalizeAccountAlertPreferences(user);
  const pendingAccount = new Map();
  let notificationPreferences;
  let notificationRevision = 0;
  let activeNotifications;
  const pendingNotifications = new Map();

  const smsDescription = document.createTextNode('');
  const smsControl = toggle(text.smsReminders);
  const inAppControl = toggle(text.inApp);
  const sms = row({ label: text.smsReminders, description: smsDescription, icon: 'smsReminders', control: smsControl });
  const inApp = row({ label: text.inApp, description: text.inAppDetail, icon: 'inAppNotifs', control: inAppControl });
  const permissions = row({ label: text.permissions, icon: 'permissions', onClick: openPermissions });
  const notifications = row({ label: text.notifications, icon: 'notifs', onClick: openNotifications });

  function renderAccount() {
    const optOut = pendingAccount.get('smsOptOut') ?? account.smsOptOut;
    smsControl.checked = !optOut;
    smsDescription.textContent = optOut ? text.smsOff : text.smsOn;
    smsControl.disabled = pendingAccount.has('smsOptOut');
    inAppControl.checked = pendingAccount.get('inAppNotifications') ?? account.inAppNotifications;
    inAppControl.disabled = pendingAccount.has('inAppNotifications');
  }

  async function saveAccount(key, value) {
    if (!isActive() || pendingAccount.has(key)) return;
    pendingAccount.set(key, value);
    renderAccount();
    try {
      await client.updateAccountAlertPreferences({ [key]: value });
      account[key] = value;
    } catch {
      if (isActive()) announce(text.saveFailed);
    } finally {
      pendingAccount.delete(key);
      if (isActive()) renderAccount();
    }
  }

  smsControl.addEventListener('change', () => saveAccount('smsOptOut', !smsControl.checked));
  inAppControl.addEventListener('change', () => saveAccount('inAppNotifications', inAppControl.checked));
  renderAccount();

  function openNotifications() {
    if (!isActive()) return;
    const content = node('div', 'feature-form settings-pref-pane');
    const status = node('p', 'dialog-note');
    status.setAttribute('role', 'status');
    const controls = new Map();
    const view = () => isActive() && content.isConnected;
    let loading = false;
    let problem = '';
    content.append(node('p', 'dialog-note', text.notificationDetail));
    for (const key of notificationKeys) {
      const control = toggle(text[key]);
      const { element } = settingDetail(text[key], text[key + 'Detail'], control);
      control.addEventListener('change', () => saveNotification(key, control.checked));
      controls.set(key, control);
      content.append(element);
    }
    const retry = action(text.retry, load);
    content.append(status, retry);
    showDialog(text.notifications, content);
    activeNotifications = render;
    void load();

    function render() {
      if (!view()) return;
      const settings = notificationPreferences;
      const enabled = pendingNotifications.get('enabled') ?? settings?.enabled;
      for (const [key, control] of controls) {
        control.checked = pendingNotifications.get(key) ?? settings?.[key] ?? true;
        control.disabled = loading || !settings || pendingNotifications.has(key) || (key !== 'enabled' && !enabled);
      }
      status.textContent = loading ? text.loading : problem;
      status.hidden = !status.textContent;
      retry.hidden = loading || problem !== text.loadFailed;
    }

    async function load() {
      if (!view() || loading) return;
      const revision = notificationRevision;
      loading = true;
      problem = '';
      render();
      try {
        const latest = await client.getNotificationPreferences();
        if (view() && revision === notificationRevision) updateNotifications(latest);
      } catch {
        if (view() && !notificationPreferences) problem = text.loadFailed;
      } finally {
        loading = false;
        render();
      }
    }

    async function saveNotification(key, value) {
      if (!view() || !notificationPreferences || pendingNotifications.has(key)) return;
      pendingNotifications.set(key, value);
      problem = '';
      render();
      try {
        await client.updateNotificationPreferences({ [key]: value });
        updateNotifications({ ...notificationPreferences, [key]: value });
      } catch {
        if (view()) problem = text.saveFailed;
      } finally {
        pendingNotifications.delete(key);
        activeNotifications?.();
      }
    }
  }

  function openPermissions() {
    if (!isActive()) return;
    const content = node('div', 'feature-form settings-pref-pane');
    const feedback = node('p', 'dialog-note');
    feedback.setAttribute('role', 'status');
    feedback.hidden = true;
    const view = () => isActive() && content.isConnected;
    content.append(node('p', 'dialog-note', text.permissionsDetail));
    for (const key of ['contacts', 'notifications', 'camera', 'microphone']) {
      let state;
      const control = action(text.grant, async () => {
        if (!view()) return;
        if (key === 'contacts') {
          closeDialog();
          openFindFriends();
          return;
        }
        feedback.hidden = true;
        if (state === 'denied' || state === 'granted') {
          feedback.textContent = text.permissionsDetail;
          feedback.hidden = false;
          return;
        }
        control.disabled = true;
        try {
          state = await requestBrowserPermission(key);
        } catch {
          feedback.textContent = text.requestFailed;
          feedback.hidden = false;
        } finally {
          displayStatus();
        }
      });
      control.disabled = true;
      const { element, help } = settingDetail(text[key], '', control);
      const stateCopy = node('small', 'settings-pref-permission-state');
      help.after(stateCopy);
      content.append(element);
      void browserPermissionStatus(key).then(status => {
        if (!view()) return;
        state = status;
        displayStatus();
      });

      function displayStatus() {
        if (!view()) return;
        help.textContent = key === 'contacts' && state === 'unsupported' ? text.contactsUnavailable : text[key + 'Detail'];
        help.hidden = false;
        stateCopy.textContent = text[state] ?? '';
        control.textContent = key === 'contacts' ? text.find : ['denied', 'granted'].includes(state) ? text.manage : text.grant;
        control.hidden = key !== 'contacts' && state === 'unsupported';
        control.disabled = false;
      }
    }
    content.append(feedback);
    showDialog(text.permissions, content);
  }

  function updateNotifications(data) {
    notificationRevision++;
    notificationPreferences = data ? normalizeNotificationPreferences(data) : undefined;
    activeNotifications?.();
  }

  return {
    permissions, sms, inApp, notifications,
    update(profile) {
      account = normalizeAccountAlertPreferences(profile);
      renderAccount();
    },
    updateNotifications,
  };
}
