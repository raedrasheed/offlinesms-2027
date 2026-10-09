// Phase 22B — pure chat-list view-model: maps a local ConversationRow to the
// shape ChatsList already renders, and filters the list. No native/db imports
// (type-only), so it runs under the node test harness.

import type { ConversationRow } from '../localdb/types';

/** Firestore-Timestamp-compatible wrapper so existing formatTime() works. */
export interface TsLike {
  toDate(): Date;
  toMillis(): number;
}

export function tsLike(ms: number | null | undefined): TsLike | null {
  if (ms == null) return null;
  return { toDate: () => new Date(ms), toMillis: () => ms };
}

export interface ChatListItem {
  id: string;
  type: 'direct' | 'group';
  peerName: string;
  photoURL?: string | null;
  memberCount?: number;
  participantKey?: string | null;
  someoneTyping: boolean;
  lastMessageText: string | null;
  lastMessageAt: TsLike | null;
  state: {
    unreadCount: number;
    pinned: boolean;
    muted: boolean;
    favorite: boolean;
    archived: boolean;
    lastMessagePreview: string | null;
    lastMessageAt: TsLike | null;
  };
}

export function mapConversationRow(row: ConversationRow): ChatListItem {
  const at = tsLike(row.last_message_at);
  return {
    id: row.id,
    type: row.type,
    peerName: row.title || (row.type === 'group' ? 'Group' : 'Conversation'),
    photoURL: row.avatar_url,
    memberCount: row.member_count,
    participantKey: row.participant_key,
    someoneTyping: false,
    lastMessageText: row.last_message_preview,
    lastMessageAt: at,
    state: {
      unreadCount: row.unread_count ?? 0,
      pinned: row.pinned === 1,
      muted: row.muted === 1,
      favorite: row.favorite === 1,
      archived: row.archived === 1,
      lastMessagePreview: row.last_message_preview,
      lastMessageAt: at,
    },
  };
}

export type ChatFilter = 'all' | 'unread' | 'favorites' | 'groups';

// Only fields consumed by mapConversationRow. Sync bookkeeping must not
// invalidate the list, but names, avatars, filters and presence keys must.
const CHAT_ITEM_FIELDS = [
  'type', 'title', 'avatar_url', 'member_count', 'participant_key',
  'last_message_preview', 'last_message_at', 'unread_count',
  'pinned', 'muted', 'favorite', 'archived',
] as const satisfies readonly (keyof ConversationRow)[];

/**
 * Preserve unchanged items (including Timestamp wrappers) across SQLite reads.
 * ChatRow's memo comparator can then skip them. Reuse the array too when its
 * order and contents are unchanged, avoiding a parent render on no-op feeds.
 * Create one mapper per signed-in user; removed items are evicted each pass.
 */
export function createChatListMapper(): (rows: ConversationRow[]) => ChatListItem[] {
  type Cached = { row: ConversationRow; item: ChatListItem };
  let previous = new Map<string, Cached>();
  let previousItems: ChatListItem[] = [];
  return rows => {
    const next = new Map<string, Cached>();
    let sameList = rows.length === previousItems.length;
    const items = rows.map((row, index) => {
      const cached = previous.get(row.id);
      const entry = cached && CHAT_ITEM_FIELDS.every(key => cached.row[key] === row[key])
        ? cached
        : { row: { ...row }, item: mapConversationRow(row) };
      next.set(row.id, entry);
      if (entry.item !== previousItems[index]) sameList = false;
      return entry.item;
    });
    previous = next;
    if (!sameList) previousItems = items;
    return previousItems;
  };
}

/** Minimal structural shape so the same filter works on local + Firestore rows. */
export interface FilterableConv {
  peerName?: string | null;
  type?: string;
  state?: { unreadCount?: number; favorite?: boolean; archived?: boolean };
}

/** Apply the chat-list filter + search. Mirrors the ChatsList filter exactly. */
export function filterChatList<T extends FilterableConv>(items: T[], filter: ChatFilter, search: string): T[] {
  let out = items;
  if (filter === 'unread')         out = out.filter(c => (c.state?.unreadCount ?? 0) > 0);
  else if (filter === 'favorites') out = out.filter(c => c.state?.favorite === true);
  else if (filter === 'groups')    out = out.filter(c => c.type === 'group');
  else                             out = out.filter(c => c.state?.archived !== true);

  const q = search.trim().toLowerCase();
  if (q) out = out.filter(c => (c.peerName ?? '').toLowerCase().includes(q));
  return out;
}
