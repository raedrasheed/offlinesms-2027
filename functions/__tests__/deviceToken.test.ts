import { describe, it, expect } from 'vitest';
import { resolveDeviceToken, deviceHasToken, isExpoPushToken } from '../src/notifications/deviceToken';

const EXPO = 'ExponentPushToken[abc123DEF456]';
const EXPO2 = 'ExpoPushToken[xyz789]';
const FCM = 'fGk9vQ:APA91bExampleFcmTokenValue1234567890';

describe('isExpoPushToken', () => {
  it('matches both Expo token shapes', () => {
    expect(isExpoPushToken(EXPO)).toBe(true);
    expect(isExpoPushToken(EXPO2)).toBe(true);
  });
  it('rejects FCM tokens, empties, and junk', () => {
    expect(isExpoPushToken(FCM)).toBe(false);
    expect(isExpoPushToken('')).toBe(false);
    expect(isExpoPushToken(null)).toBe(false);
    expect(isExpoPushToken('ExponentPushToken[]')).toBe(false);
  });
});

describe('resolveDeviceToken — provider routing', () => {
  it('Android FCM device → provider fcm', () => {
    expect(resolveDeviceToken({ provider: 'fcm', pushToken: FCM, fcmToken: FCM, enabled: true }))
      .toEqual({ provider: 'fcm', token: FCM });
  });
  it('iOS Expo device → provider expo (token from pushToken)', () => {
    expect(resolveDeviceToken({ provider: 'expo', pushToken: EXPO, fcmToken: null }))
      .toEqual({ provider: 'expo', token: EXPO });
  });
  it('legacy Android doc (only fcmToken, no provider) → fcm', () => {
    expect(resolveDeviceToken({ fcmToken: FCM }))
      .toEqual({ provider: 'fcm', token: FCM });
  });
  it('defensive: an Expo-shaped token without provider still routes to expo', () => {
    expect(resolveDeviceToken({ pushToken: EXPO }))
      .toEqual({ provider: 'expo', token: EXPO });
    expect(resolveDeviceToken({ fcmToken: EXPO }))
      .toEqual({ provider: 'expo', token: EXPO });
  });
  it('expo provider but no usable expo token → null (never sends an FCM token to Expo)', () => {
    expect(resolveDeviceToken({ provider: 'expo', pushToken: FCM })).toBeNull();
    expect(resolveDeviceToken({ provider: 'expo' })).toBeNull();
  });
  it('no token at all → null', () => {
    expect(resolveDeviceToken({})).toBeNull();
    expect(resolveDeviceToken({ pushToken: '', fcmToken: '' })).toBeNull();
  });
  it('trims surrounding whitespace', () => {
    expect(resolveDeviceToken({ provider: 'fcm', fcmToken: `  ${FCM}  ` }))
      .toEqual({ provider: 'fcm', token: FCM });
  });
});

describe('deviceHasToken', () => {
  it('true when a usable token exists, false otherwise', () => {
    expect(deviceHasToken({ provider: 'expo', pushToken: EXPO })).toBe(true);
    expect(deviceHasToken({ fcmToken: FCM })).toBe(true);
    expect(deviceHasToken({ provider: 'expo' })).toBe(false);
    expect(deviceHasToken({})).toBe(false);
  });
});
