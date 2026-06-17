import { describe, it, expect } from 'vitest';
import {
  buildExpoMessage, chunkExpoMessages, isExpoDeadTokenTicket,
  EXPO_PUSH_CHUNK, type ExpoTicket,
} from '../src/notifications/expoPushLogic';

const TOKEN = 'ExponentPushToken[abc123]';
const base = {
  title: 'Raed', body: 'Hello',
  data: { type: 'chat_message', conversationId: 'c1', route: 'Conversation' },
  conversationId: 'c1',
};

describe('buildExpoMessage', () => {
  it('loud message: sound default + high priority + messages channel', () => {
    const m = buildExpoMessage(TOKEN, base);
    expect(m).toMatchObject({
      to: TOKEN, title: 'Raed', body: 'Hello',
      data: base.data, sound: 'default', priority: 'high', channelId: 'messages',
    });
  });
  it('silent message: no sound, default priority, still shows title/body', () => {
    const m = buildExpoMessage(TOKEN, { ...base, silent: true });
    expect(m.sound).toBeNull();
    expect(m.priority).toBe('default');
    expect(m.title).toBe('Raed');
    expect(m.body).toBe('Hello');
  });
});

describe('chunkExpoMessages', () => {
  it('splits into ≤100-message requests (Expo limit)', () => {
    const msgs = Array.from({ length: 250 }, () => buildExpoMessage(TOKEN, base));
    const chunks = chunkExpoMessages(msgs);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(EXPO_PUSH_CHUNK);
    expect(chunks[2].length).toBe(50);
  });
  it('empty in → empty out', () => {
    expect(chunkExpoMessages([])).toEqual([]);
  });
});

describe('isExpoDeadTokenTicket', () => {
  it('DeviceNotRegistered → dead token', () => {
    const t: ExpoTicket = { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } };
    expect(isExpoDeadTokenTicket(t)).toBe(true);
  });
  it('ok ticket / other errors / undefined → not dead', () => {
    expect(isExpoDeadTokenTicket({ status: 'ok', id: 'r1' })).toBe(false);
    expect(isExpoDeadTokenTicket({ status: 'error', details: { error: 'MessageTooBig' } })).toBe(false);
    expect(isExpoDeadTokenTicket({ status: 'error', message: 'expo-http-429' })).toBe(false);
    expect(isExpoDeadTokenTicket(undefined)).toBe(false);
  });
});
