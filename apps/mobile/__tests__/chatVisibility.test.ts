import { describe, expect, it } from 'vitest';
import { conversationRevision, isConversationVisible } from '../src/lib/chatVisibility';

const ts = (ms: number) => ({ toMillis: () => ms });
const direct = { type: 'direct', lastMessage: null, lastMessageText: '', lastMessageAt: ts(100) };
const sent = { ...direct, lastMessage: { messageId: 'm1', createdAt: ts(200), preview: 'hello' }, lastMessageText: 'hello' };

describe('inbox lifecycle', () => {
  it('does not put a newly opened direct chat in either participant inbox', () => {
    for (const uid of ['sender', 'recipient']) {
      expect(isConversationVisible({ ...direct, lastMessageAt: ts(uid === 'sender' ? 100 : 101) })).toBe(false);
    }
    expect(isConversationVisible(sent)).toBe(true);
  });
  it('preserves new groups, legacy summaries and unknown legacy parents', () => {
    expect(isConversationVisible({ ...direct, type: 'group' })).toBe(true);
    expect(isConversationVisible({ type: 'direct', lastMessageText: 'old message' })).toBe(true);
    expect(isConversationVisible({ type: 'direct' })).toBe(true);
  });
  it('keeps a deleted chat hidden after reopening, profile edits and stale summary replay', () => {
    const deleted = conversationRevision(sent);
    expect(isConversationVisible(sent, deleted)).toBe(false);
    expect(isConversationVisible({ ...sent, lastMessageText: 'edited preview', lastMessageAt: ts(999) }, deleted)).toBe(false);
    expect(isConversationVisible({ ...sent, lastMessage: { messageId: 'older', createdAt: ts(150) } }, deleted)).toBe(false);
    expect(isConversationVisible(sent)).toBe(true); // The other user's inbox is unaffected.
  });
  it('restores a deleted chat for a new incoming or sent message, including equal timestamp ids', () => {
    const deleted = conversationRevision(sent);
    expect(isConversationVisible({ ...sent, lastMessage: { messageId: 'm2', createdAt: ts(201) } }, deleted)).toBe(true);
    expect(isConversationVisible({ ...sent, lastMessage: { messageId: 'm2', createdAt: ts(200) } }, deleted)).toBe(true);
  });
  it('treats the SQLite view model identically to the remote summary', () => {
    const local = { type: 'direct', lastMessageId: 'm1', lastMessageAt: ts(200), lastMessageText: 'hello' };
    expect(conversationRevision(local)).toEqual(conversationRevision(sent));
    expect(isConversationVisible(local, conversationRevision(sent))).toBe(false);
    expect(isConversationVisible({ ...local, lastMessageId: 'm2', lastMessageAt: ts(201) }, conversationRevision(sent))).toBe(true);
  });
});
