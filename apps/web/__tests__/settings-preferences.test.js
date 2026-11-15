import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createSettingsPreferencesClient, normalizeAccountAlertPreferences, normalizeNotificationPreferences,
} from '../settings-preferences-client.js';
import {
  browserPermissionStatus, requestBrowserPermission, showConnectedBrowserNotification,
} from '../settings-browser-permissions.js';

test('notification settings keep existing flags and default missing or malformed flags', () => {
  assert.deepEqual(normalizeAccountAlertPreferences({
    smsOptOut: true, inAppNotifications: false, other: 'ignored',
  }), { smsOptOut: true, inAppNotifications: false });
  assert.deepEqual(normalizeNotificationPreferences({ enabled: false, showPreview: false, sound: null }), {
    enabled: false, directMessages: true, groupMessages: true, reactions: true, sound: true, vibration: true, showPreview: false,
  });
});

test('preference writes use the authenticated account and preserve other preferences', async () => {
  const writes = [];
  let uid = 'me';
  const client = createSettingsPreferencesClient({
    sdk: {
      doc: (_, ...path) => path.join('/'),
      serverTimestamp: () => 'timestamp',
      updateDoc: async (...args) => writes.push(args),
      setDoc: async (...args) => writes.push(args),
      getDocFromServer: async () => {
        uid = 'other';
        return { data: () => ({ sound: false }) };
      },
    },
    db: {},
    currentUid: () => uid,
    requireSession: expected => { if (expected !== uid) throw new Error('account-changed'); },
  });
  await client.updateAccountAlertPreferences({ smsOptOut: true });
  await client.updateNotificationPreferences({ reactions: false });
  await assert.rejects(client.updateAccountAlertPreferences({ status: true }), /invalid-notification-preferences/);
  await assert.rejects(client.updateNotificationPreferences({ sound: 'no' }), /invalid-notification-preferences/);
  await assert.rejects(client.getNotificationPreferences(), /account-changed/);
  assert.deepEqual(writes, [
    ['users/me', { smsOptOut: true, updatedAt: 'timestamp' }],
    ['users/me/notificationSettings/current', { reactions: false, updatedAt: 'timestamp' }, { merge: true }],
  ]);
});

test('contacts have per-use access and media permission checks release the media tracks', async () => {
  const browser = { navigator: { contacts: { select() {} }, mediaDevices: {} } };
  assert.equal(await browserPermissionStatus('contacts', browser), 'per-use');
  assert.equal(await browserPermissionStatus('microphone', browser), 'unsupported');
  const calls = [];
  browser.navigator.mediaDevices.getUserMedia = async options => {
    calls.push(options);
    return { getTracks: () => [{ stop: () => calls.push('stop') }] };
  };
  assert.equal(await requestBrowserPermission('microphone', browser), 'granted');
  assert.deepEqual(calls, [{ audio: true, video: false }, 'stop']);
});

test('connected browser alerts require permission and can be silent or actionable', () => {
  const calls = [];
  const browser = {
    Notification: class {
      static permission = 'denied';
      constructor(title, options) { calls.push([title, options]); }
      close() { calls.push('close'); }
    },
    focus: () => calls.push('focus'),
  };
  const options = {
    title: 'New message', body: 'Open OfflineSMS to read it.', tag: 'chat', sound: false,
    onOpen: () => calls.push('open'),
  };
  assert.equal(showConnectedBrowserNotification(options, browser), null);
  browser.Notification.permission = 'granted';
  const notice = showConnectedBrowserNotification(options, browser);
  notice.onclick();
  assert.deepEqual(calls, [
    ['New message', { body: options.body, tag: 'chat', icon: './logo.png', silent: true }],
    'close', 'focus', 'open',
  ]);
});
