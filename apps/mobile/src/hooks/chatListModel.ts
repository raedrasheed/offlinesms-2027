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
  memberCount?: number;
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
    memberCount: row.member_count,
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
