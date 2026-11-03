/** Inbox visibility is independent of opening a profile/conversation. */
export type ConversationSummary = {
  type?: string;
  lastMessage?: { messageId?: string; createdAt?: any; preview?: string } | null;
  lastMessageId?: string | null;
  lastMessageAt?: any;
  lastMessageText?: string | null;
};

export type HiddenChat = { messageAt: number; messageId: string | null };

export function conversationRevision(row: ConversationSummary): HiddenChat {
  const at = row.lastMessage?.createdAt ?? row.lastMessageAt;
  const ms = typeof at === 'number' ? at : at?.toMillis?.();
  return {
    messageAt: typeof ms === 'number' && Number.isFinite(ms) ? ms : 0,
    messageId: row.lastMessage?.messageId ?? row.lastMessageId ?? null,
  };
}

export function hasConversationMessages(row: ConversationSummary): boolean {
  if (row.lastMessage?.messageId || row.lastMessageId
    || row.lastMessage?.preview?.trim() || row.lastMessageText?.trim()) return true;
  // A legacy parent with no summary is unknown, not proven empty. The local
  // repository also fills a missing summary from any downloaded messages.
  return row.lastMessageText == null && row.lastMessage == null;
}

export function isConversationVisible(row: ConversationSummary, hidden?: HiddenChat): boolean {
  if (row.type !== 'group' && !hasConversationMessages(row)) return false;
  if (!hidden) return true;
  const current = conversationRevision(row);
  // Peer changes, reopening the thread and delayed snapshots cannot resurrect
  // a deleted row. A different message at the same timestamp can (batch sends).
  return current.messageAt > hidden.messageAt
    || (current.messageAt === hidden.messageAt && !!hidden.messageId
      && !!current.messageId && current.messageId !== hidden.messageId);
}
