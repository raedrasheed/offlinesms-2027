import { describe, expect, it } from 'vitest';
import { retentionPolicy, retentionCutoff, DAY_MS, ownedMediaPrefix, validRetentionDays } from '../src/chats/messageRetentionPolicy';
import { notificationReady } from '../src/notifications/onMessageCreateNotify';
describe('cloud retention policy', () => {
  it('defaults to 14 days and requires explicit first activation', () => {
    expect(retentionPolicy()).toEqual({ days: 14, enabled: false });
    expect(retentionCutoff(20 * DAY_MS, 14)).toBe(6 * DAY_MS);
  });
  it('accepts only bounded whole days', () => {
    for (const x of [0, -1, 1.5, 3651, NaN, Infinity, '14']) expect(validRetentionDays(x)).toBe(false);
    expect(validRetentionDays(14)).toBe(true);
    expect(() => retentionPolicy({ messageRetentionEnabled: true, messageRetentionDays: 0 })).toThrow();
  });
  it('only derives storage prefixes owned by that exact chat message', () => {
    expect(ownedMediaPrefix('conversations/c/messages/m', { senderUid: 'u', type: 'image', media: { storagePath: 'other/data' } })).toBe('chatMedia/c/u/m/');
    expect(ownedMediaPrefix('tickets/t/messages/m', { senderUid: 'u', type: 'image' })).toBeNull();
    expect(ownedMediaPrefix('conversations/c/messages/m', { senderUid: 'u/x', type: 'image' })).toBeNull();
  });
});
describe('push media readiness', () => {
  it('waits for upload completion and URL and suppresses deleted/expiring messages', () => {
    expect(notificationReady({ type: 'text' })).toBe(true);
    expect(notificationReady({ type: 'image', media: { uploadStatus: 'pending' } })).toBe(false);
    expect(notificationReady({ type: 'voice', media: { uploadStatus: 'uploaded' } })).toBe(false);
    expect(notificationReady({ type: 'voice', media: { uploadStatus: 'uploaded', downloadURL: 'https://file' } })).toBe(true);
    expect(notificationReady({ type: 'text', retentionDeleting: true })).toBe(false);
  });
});
