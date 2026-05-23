// Legacy facade.
//
// Phase 4 moved the data layer to `apps/mobile/src/lib/conversations.ts`.
// This file re-exports the subset the older screens already import so
// nothing has to change just because the underlying shape evolved.

export {
  subscribeConversations,
  subscribeMessages,
  sendTextMessage as sendText,
} from './conversations';

export type { Conversation, Message } from './conversations';
