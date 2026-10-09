import { describe, it, expect } from 'vitest';
import {
  mapConversationRow,
  createChatListMapper,
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
    expect(mapConversationRow(row({ type: 'direct', title: null })).peerName).toBe('Unknown user');
  });
  it('uses the translated labels it is given (never a uid)', () => {
    const labels = { group: 'مجموعة', direct: 'مستخدم غير معروف' };
    expect(mapConversationRow(row({ type: 'group', title: null }), labels).peerName).toBe('مجموعة');
    expect(mapConversationRow(row({ type: 'direct', title: null }), labels).peerName).toBe('مستخدم غير معروف');
    expect(createChatListMapper(labels)([row({ type: 'direct', title: null })])[0].peerName).toBe('مستخدم غير معروف');
  });
});

describe('chat-list identity across database refreshes', () => {
  const chats = () => Array.from({ length: 50 }, (_, i) => row({
    id: `c${i}`, title: `Chat ${i}`, last_message_at: 1700000000000 + i,
  }));

  it('one incoming message changes one item, keeping the other 49 rows and timestamps stable', () => {
    const map = createChatListMapper();
    const rows = chats();
    const before = map(rows);
    const after = map(rows.map((r, i) => i === 17
      ? { ...r, last_message_preview: 'New message', last_message_at: 1700000001000, unread_count: 1 }
      : { ...r }));
    expect(after.filter((item, i) => item !== before[i])).toHaveLength(1);
    expect(after[0].lastMessageAt).toBe(before[0].lastMessageAt);
    expect(after[17].lastMessageText).toBe('New message');
    expect(after[17].state.unreadCount).toBe(1);
  });

  it('does not invalidate the list for an identical read or bookkeeping-only changes', () => {
    const map = createChatListMapper();
    const rows = chats();
    const before = map(rows);
    expect(map(rows.map(r => ({ ...r })))).toBe(before);
    expect(map(rows.map(r => ({ ...r, local_updated_at: 42, sync_status: 'dirty' })))).toBe(before);
  });

  it('preserves rows when reordered and evicts removed rows', () => {
    const map = createChatListMapper();
    const rows = chats().slice(0, 3);
    const before = map(rows);
    const reordered = map([rows[2], rows[0], rows[1]].map(r => ({ ...r })));
    expect(reordered).not.toBe(before);
    expect(reordered[0]).toBe(before[2]);
    expect(reordered[1]).toBe(before[0]);
    map([rows[0], rows[2]]);
    const restored = map(rows);
    expect(restored[0]).toBe(before[0]);
    expect(restored[1]).not.toBe(before[1]);
    expect(map([])).toEqual([]);
  });

  it.each<Partial<ConversationRow>>([
    { title: 'Renamed' }, { avatar_url: 'https://example.test/avatar.png' },
    { type: 'group' }, { member_count: 12 }, { participant_key: 'a_b' },
    { last_message_preview: 'Edited' }, { last_message_at: 123 },
    { unread_count: 3 }, { pinned: 1 }, { muted: 1 }, { favorite: 1 }, { archived: 1 },
  ])('keeps visible and filtering changes fresh: %j', change => {
    const map = createChatListMapper();
    const original = row({});
    const before = map([original]);
    const changed = { ...original, ...change };
    const after = map([changed]);
    expect(after[0]).not.toBe(before[0]);
    // Compare values without Timestamp wrapper function identities.
    expect(JSON.stringify(after[0])).toBe(JSON.stringify(mapConversationRow(changed)));
    expect(after[0].lastMessageAt?.toMillis()).toBe(changed.last_message_at ?? undefined);
  });

  it('does not reuse another user\'s cached items or retain a mutable input row', () => {
    const firstUser = createChatListMapper();
    const secondUser = createChatListMapper();
    const input = row({ title: 'Before' });
    const before = firstUser([input]);
    expect(secondUser([{ ...input }])[0]).not.toBe(before[0]);
    input.title = 'After';
    expect(firstUser([input])[0].peerName).toBe('After');
    expect(before[0].peerName).toBe('Before');
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
