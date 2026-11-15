const supportedStates = new Set(['granted', 'denied', 'prompt']);

function notificationStatus(permission) {
  return permission === 'default' ? 'prompt' : supportedStates.has(permission) ? permission : 'unsupported';
}

export async function browserPermissionStatus(kind, browser = globalThis) {
  if (kind === 'contacts') {
    return typeof browser.navigator?.contacts?.select === 'function' ? 'per-use' : 'unsupported';
  }
  if (kind === 'notifications') {
    return notificationStatus(browser.Notification?.permission);
  }
  const { mediaDevices, permissions } = browser.navigator ?? {};
  if (typeof mediaDevices?.getUserMedia !== 'function') return 'unsupported';
  try {
    const permission = await permissions?.query({ name: kind });
    if (supportedStates.has(permission?.state)) return permission.state;
  } catch { /* Some browsers request media access without a Permissions API descriptor. */ }
  return 'prompt';
}

export async function requestBrowserPermission(kind, browser = globalThis) {
  if (kind === 'notifications') {
    const api = browser.Notification;
    return api?.requestPermission ? notificationStatus(await api.requestPermission()) : 'unsupported';
  }
  if (!['camera', 'microphone'].includes(kind)) return 'unsupported';
  const media = browser.navigator?.mediaDevices;
  if (!media?.getUserMedia) return 'unsupported';
  try {
    const stream = await media.getUserMedia({ audio: kind === 'microphone', video: kind === 'camera' });
    for (const track of stream.getTracks()) track.stop();
    return 'granted';
  } catch (error) {
    if (error?.name === 'NotAllowedError') return browserPermissionStatus(kind, browser);
    if (error?.name === 'NotFoundError') return 'no-device';
    throw error;
  }
}

export function showConnectedBrowserNotification({ title, body, tag, sound, vibration, onOpen }, browser = globalThis) {
  if (browser.Notification?.permission !== 'granted') return null;
  try {
    const settings = { body, tag, icon: './logo.png' };
    if (sound === false) settings.silent = true;
    else if (vibration === false) settings.vibrate = [];
    const notice = new browser.Notification(title, settings);
    notice.onclick = () => {
      notice.close();
      browser.focus?.();
      onOpen?.();
    };
    return notice;
  } catch {
    // Some mobile browsers only allow service-worker notifications.
    return null;
  }
}
