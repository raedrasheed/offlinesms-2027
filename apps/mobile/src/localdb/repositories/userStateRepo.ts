// Phase 22 — per-user conversation state. In the local schema this is folded
// into the `conversations` row (unread/muted/pinned/favorite/archived), so this
// repo is a thin, intention-revealing wrapper over conversationsRepo.
import { applyUserState } from './conversationsRepo';

export interface UserStatePatch {
  unreadCount?: number;
  muted?: boolean;
  pinned?: boolean;
  favorite?: boolean;
  archived?: boolean;
}

export async function applyUserStateForConversation(conversationId: string, patch: UserStatePatch): Promise<void> {
  await applyUserState(conversationId, {
    unread_count: patch.unreadCount,
    muted: patch.muted === undefined ? undefined : patch.muted ? 1 : 0,
    pinned: patch.pinned === undefined ? undefined : patch.pinned ? 1 : 0,
    favorite: patch.favorite === undefined ? undefined : patch.favorite ? 1 : 0,
    archived: patch.archived === undefined ? undefined : patch.archived ? 1 : 0,
  });
}
