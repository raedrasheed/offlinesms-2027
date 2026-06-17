import { describe, it, expect } from 'vitest';
import {
  providerForPlatform, usesExpoToken, isExpoPushToken, buildDeviceRecord,
} from '../src/lib/pushTokens';

describe('providerForPlatform', () => {
  it('iOS → expo, Android/other → fcm', () => {
    expect(providerForPlatform('ios')).toBe('expo');
    expect(providerForPlatform('android')).toBe('fcm');
    expect(providerForPlatform('web')).toBe('fcm');
  });
});

describe('usesExpoToken / isExpoPushToken', () => {
  it('iOS uses Expo tokens', () => {
    expect(usesExpoToken('ios')).toBe(true);
    expect(usesExpoToken('android')).toBe(false);
  });
  it('recognizes Expo token shapes', () => {
    expect(isExpoPushToken('ExponentPushToken[abc]')).toBe(true);
    expect(isExpoPushToken('ExpoPushToken[abc]')).toBe(true);
    expect(isExpoPushToken('fcm-token')).toBe(false);
    expect(isExpoPushToken(null)).toBe(false);
  });
});

describe('buildDeviceRecord — Firestore device doc', () => {
  it('iOS: provider expo, token in pushToken, fcmToken null', () => {
    const rec = buildDeviceRecord({
      deviceId: 'ios_1', token: 'ExponentPushToken[abc]', platform: 'ios',
      appVersion: '2.2.14', buildVersion: '42',
    });
    expect(rec).toMatchObject({
      deviceId: 'ios_1', provider: 'expo',
      pushToken: 'ExponentPushToken[abc]', fcmToken: null,
      platform: 'ios', appVersion: '2.2.14', buildVersion: '42', enabled: true,
    });
  });
  it('Android: provider fcm, token in both pushToken and fcmToken (back-compat)', () => {
    const rec = buildDeviceRecord({
      deviceId: 'and_1', token: 'fcm-xyz', platform: 'android',
    });
    expect(rec).toMatchObject({
      deviceId: 'and_1', provider: 'fcm', pushToken: 'fcm-xyz', fcmToken: 'fcm-xyz',
      platform: 'android', enabled: true,
    });
  });
  it('null-fills optional metadata', () => {
    const rec = buildDeviceRecord({ deviceId: 'd', token: 't', platform: 'android' });
    expect(rec.appVersion).toBeNull();
    expect(rec.buildVersion).toBeNull();
    expect(rec.locale).toBeNull();
    expect(rec.timezone).toBeNull();
  });
});
