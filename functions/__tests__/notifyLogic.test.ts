import { describe, it, expect } from 'vitest';
import {
  messagePreview, buildNotification, decideForRecipient, isDeadTokenError, collapseKey,
  decideReactionForRecipient, buildReactionNotification,
} from '../src/notifications/notifyLogic';

describe('messagePreview', () => {
  it('friendly media previews', () => {
    expect(messagePreview({ type: 'image' })).toBe('📷 Photo');
    expect(messagePreview({ type: 'voice' })).toBe('🎤 Voice message');
  });
  it('text preview collapses whitespace + truncates', () => {
    expect(messagePreview({ type: 'text', text: '  hi   there ' })).toBe('hi there');
    expect(messagePreview({ type: 'text', text: 'x'.repeat(200) }).endsWith('…')).toBe(true);
  });
  it('falls back to generic label', () => {
    expect(messagePreview({ type: 'text', text: '' })).toBe('Message');
  });
});

describe('buildNotification', () => {
  it('direct chat: sender title + preview body', () => {
    expect(buildNotification({ chatType: 'direct', senderName: 'Raed', msg: { type: 'text', text: 'Hello' }, showPreview: true }))
      .toEqual({ title: 'Raed', body: 'Hello' });
  });
  it('group chat: group title + "Sender: preview" body', () => {
    expect(buildNotification({ chatType: 'group', groupName: 'Project Team', senderName: 'Ahmed', msg: { type: 'image' }, showPreview: true }))
      .toEqual({ title: 'Project Team', body: 'Ahmed: 📷 Photo' });
  });
  it('showPreview=false hides content (direct + group)', () => {
    expect(buildNotification({ chatType: 'direct', senderName: 'Raed', msg: { type: 'text', text: 'secret' }, showPreview: false }))
      .toEqual({ title: 'New message', body: 'Open OfflineSMS to read it' });
    expect(buildNotification({ chatType: 'group', groupName: 'G', senderName: 'A', msg: { type: 'text', text: 'secret' }, showPreview: false }))
      .toEqual({ title: 'New group message', body: 'Open OfflineSMS to read it' });
  });
});

describe('decideForRecipient', () => {
  it('never notifies the sender', () => {
    expect(decideForRecipient({ uid: 'u1' }, 'direct', 'u1')).toMatchObject({ notify: false, reason: 'sender' });
  });
  it('default-on for a recipient with no settings doc', () => {
    expect(decideForRecipient({ uid: 'u2' }, 'direct', 'u1')).toMatchObject({ notify: true, silent: false });
  });
  it('respects enabled=false', () => {
    expect(decideForRecipient({ uid: 'u2', settings: { enabled: false } }, 'direct', 'u1')).toMatchObject({ notify: false, reason: 'disabled' });
  });
  it('respects per-type toggles', () => {
    expect(decideForRecipient({ uid: 'u2', settings: { groupMessages: false } }, 'group', 'u1')).toMatchObject({ notify: false, reason: 'type-off' });
    expect(decideForRecipient({ uid: 'u2', settings: { directMessages: false } }, 'direct', 'u1')).toMatchObject({ notify: false, reason: 'type-off' });
    // group toggle off doesn't block direct messages
    expect(decideForRecipient({ uid: 'u2', settings: { groupMessages: false } }, 'direct', 'u1').notify).toBe(true);
  });
  it('muted chat → silent', () => {
    expect(decideForRecipient({ uid: 'u2', muted: true }, 'direct', 'u1')).toMatchObject({ notify: true, silent: true });
  });
  it('sound off → silent', () => {
    expect(decideForRecipient({ uid: 'u2', settings: { sound: false } }, 'direct', 'u1')).toMatchObject({ notify: true, silent: true });
  });
});

describe('isDeadTokenError', () => {
  it('flags unregistered / invalid tokens', () => {
    expect(isDeadTokenError('messaging/registration-token-not-registered')).toBe(true);
    expect(isDeadTokenError('messaging/invalid-registration-token')).toBe(true);
    expect(isDeadTokenError('messaging/internal-error')).toBe(false);
    expect(isDeadTokenError(undefined)).toBe(false);
  });
});

describe('collapseKey', () => {
  it('is stable per conversation', () => {
    expect(collapseKey('g1')).toBe('convo_g1');
  });
});

describe('decideReactionForRecipient', () => {
  it('never notifies for a self-reaction', () => {
    expect(decideReactionForRecipient({ uid: 'author' }, 'author', 'author')).toMatchObject({ notify: false, reason: 'sender' });
  });
  it('default-on notifies the author', () => {
    expect(decideReactionForRecipient({ uid: 'author' }, 'author', 'actor')).toMatchObject({ notify: true, silent: false });
  });
  it('respects the reactions toggle', () => {
    expect(decideReactionForRecipient({ uid: 'author', settings: { reactions: false } }, 'author', 'actor')).toMatchObject({ notify: false, reason: 'type-off' });
  });
  it('respects master enabled + mute (silent)', () => {
    expect(decideReactionForRecipient({ uid: 'author', settings: { enabled: false } }, 'author', 'actor').notify).toBe(false);
    expect(decideReactionForRecipient({ uid: 'author', muted: true }, 'author', 'actor')).toMatchObject({ notify: true, silent: true });
  });
});

describe('buildReactionNotification', () => {
  it('direct: actor title + "Reacted <emoji>"', () => {
    expect(buildReactionNotification({ chatType: 'direct', actorName: 'Ahmed', emoji: '👍' }))
      .toEqual({ title: 'Ahmed', body: 'Reacted 👍 to your message' });
  });
  it('group: group title + "Actor reacted <emoji>"', () => {
    expect(buildReactionNotification({ chatType: 'group', groupName: 'Team', actorName: 'Ahmed', emoji: '❤️' }))
      .toEqual({ title: 'Team', body: 'Ahmed reacted ❤️ to your message' });
  });
});
