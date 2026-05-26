import { describe, it, expect } from 'vitest';
import {
  mapConversationRow,
  filterChatList,
  tsLike,
  type ChatListItem,
} from '../../src/hooks/chatListModel';
import type { ConversationRow } from '../../src/localdb/types';

function row(p: Partial<ConversationRow>): ConversationRow {
  return {
    id: 'c1', remote_id: 'c1', type: 'direct', title: null, avatar_url: null,
    participant_key: null, owner_uid: null, status: 'active', member_count: 0,
    pinned_message_id: null, last_message_id: null, last_message_preview: null,
    last_message_at: null, unread_count: 0, muted: 0, pinned: 0, favorite: 0,
    archived: 0, local_updated_at: 0, remote_updated_at: null, sync_status: 'synced',
    ...p,
  };
}

describe('tsLike', () => {
  it('wraps epoch ms in a Timestamp-like object', () => {
    const t = tsLike(1700000000000)!;
    expect(t.toMillis()).toBe(1700000000000);
    expect(t.toDate() instanceof Date).toBe(true);
  });
  it('returns null for null', () => {
    expect(tsLike(null)).toBeNull();
  });
});

describe('mapConversationRow', () => {
  it('maps a direct conversation row to a view-model', () => {
    const item = mapConversationRow(row({
      id: 'd1', type: 'direct', title: 'Raed', last_message_preview: 'hi',
      last_message_at: 1700000000000, unread_count: 3, favorite: 1, pinned: 1,
    }));
    expect(item.id).toBe('d1');
    expect(item.type).toBe('direct');
    expect(item.peerName).toBe('Raed');
    expect(item.lastMessageText).toBe('hi');
    expect(item.state.unreadCount).toBe(3);
    expect(item.state.favorite).toBe(true);
    expect(item.state.pinned).toBe(true);
    expect(item.state.muted).toBe(false);
    expect(item.lastMessageAt?.toMillis()).toBe(1700000000000);
  });
  it('falls back to a placeholder name', () => {
    expect(mapConversationRow(row({ type: 'group', title: null })).peerName).toBe('Group');
    expect(mapConversationRow(row({ type: 'direct', title: null })).peerName).toBe('Conversation');
  });
});

function item(p: Partial<ChatListItem>): ChatListItem {
  return {
    id: 'x', type: 'direct', peerName: 'X', someoneTyping: false,
    lastMessageText: null, lastMessageAt: null,
    state: { unreadCount: 0, pinned: false, muted: false, favorite: false, archived: false, lastMessagePreview: null, lastMessageAt: null },
    ...p,
  };
}

describe('filterChatList', () => {
  const items: ChatListItem[] = [
    item({ id: 'a', peerName: 'Ahmed', type: 'direct', state: { unreadCount: 2, favorite: true, archived: false, pinned: false, muted: false, lastMessagePreview: null, lastMessageAt: null } }),
    item({ id: 'b', peerName: 'Sara', type: 'group', state: { unreadCount: 0, favorite: false, archived: false, pinned: false, muted: false, lastMessagePreview: null, lastMessageAt: null } }),
    item({ id: 'c', peerName: 'Archived One', type: 'direct', state: { unreadCount: 0, favorite: false, archived: true, pinned: false, muted: false, lastMessagePreview: null, lastMessageAt: null } }),
  ];

  it('all → hides archived', () => {
    expect(filterChatList(items, 'all', '').map(i => i.id)).toEqual(['a', 'b']);
  });
  it('unread → only unread', () => {
    expect(filterChatList(items, 'unread', '').map(i => i.id)).toEqual(['a']);
  });
  it('favorites → only favorites', () => {
    expect(filterChatList(items, 'favorites', '').map(i => i.id)).toEqual(['a']);
  });
  it('groups → only groups', () => {
    expect(filterChatList(items, 'groups', '').map(i => i.id)).toEqual(['b']);
  });
  it('search filters by peer name (case-insensitive)', () => {
    expect(filterChatList(items, 'all', 'ahm').map(i => i.id)).toEqual(['a']);
    expect(filterChatList(items, 'all', 'SARA').map(i => i.id)).toEqual(['b']);
  });
});
