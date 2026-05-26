// Phase 22 — local-first data layer types.
//
// These are the row shapes for the on-device SQLite database. They are
// deliberately flat (numbers for booleans/timestamps) to match SQLite storage
// and to keep chat-list queries cheap (no JSON parse per row). This module is
// pure (no expo-sqlite import) so it can be used by the sync logic and unit
// tests in a node environment.

export type SyncStatus = 'synced' | 'pending' | 'dirty' | 'conflict' | 'deleted';
export type MessageSyncStatus = 'synced' | 'pending' | 'dirty' | 'conflict' | 'failed';

export type ConversationType = 'direct' | 'group';
export type ConversationStatus = 'active' | 'locked' | 'archived' | 'disabled';

export type MessageStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed';

export type ReceiptStatus =
  | 'pending'
  | 'delivered'
  | 'read'
  | 'viewed'
  | 'played'
  | 'failed';

export type MemberRole = 'owner' | 'admin' | 'member';
export type MemberStatus = 'active' | 'left' | 'removed';

export type OutboxType =
  | 'send_message'
  | 'edit_message'
  | 'delete_message'
  | 'react_message'
  | 'star_message'
  | 'pin_message'
  | 'mark_receipt'
  | 'create_group'
  | 'group_action'
  | 'sms_escalation'
  | 'support_ticket';

export type OutboxStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'dead';

export interface ConversationRow {
  id: string;
  remote_id: string | null;
  type: ConversationType;
  title: string | null;
  avatar_url: string | null;
  participant_key: string | null;
  owner_uid: string | null;
  status: ConversationStatus;
  member_count: number;
  pinned_message_id: string | null;
  last_message_id: string | null;
  last_message_preview: string | null;
  last_message_at: number | null;
  unread_count: number;
  muted: number;
  pinned: number;
  favorite: number;
  archived: number;
  local_updated_at: number;
  remote_updated_at: number | null;
  sync_status: SyncStatus;
}

export interface MessageRow {
  id: string;
  local_id: string | null;
  remote_id: string | null;
  conversation_id: string;
  sender_uid: string;
  sender_display_name: string | null;
  type: 'text';
  text: string | null;
  preview: string | null;
  created_at: number;
  remote_created_at: number | null;
  updated_at: number;
  edited_at: number | null;
  deleted_for_everyone: number;
  deleted_for_me: number;
  deleted_at: number | null;
  reply_to_message_id: string | null;
  reply_to_preview: string | null;
  forwarded: number;
  forwarded_from_message_id: string | null;
  status: MessageStatus;
  error_code: string | null;
  error_message: string | null;
  sync_status: MessageSyncStatus;
  client_sequence: number;
  server_version: number;
  // Phase 22C — denormalized for local rendering (JSON reactions map + receipt
  // aggregate counts, mirroring the Firestore message doc).
  reactions_json: string | null;
  delivered_count: number;
  read_count: number;
  viewed_count: number;
  played_count: number;
}

export interface ReactionRow {
  id: string;
  message_id: string;
  emoji: string;
  user_uid: string;
  created_at: number;
  sync_status: SyncStatus;
}

export interface ReceiptRow {
  id: string;
  message_id: string;
  user_uid: string;
  status: ReceiptStatus;
  delivered_at: number | null;
  read_at: number | null;
  viewed_at: number | null;
  played_at: number | null;
  failed_at: number | null;
  sync_status: SyncStatus;
}

export interface MemberRow {
  id: string;
  conversation_id: string;
  uid: string;
  display_name: string | null;
  photo_url: string | null;
  role: MemberRole;
  status: MemberStatus;
  joined_at: number | null;
  updated_at: number | null;
}

export interface OutboxRow {
  id: string;
  type: OutboxType;
  entity_type: string | null;
  entity_id: string | null;
  conversation_id: string | null;
  payload_json: string;
  status: OutboxStatus;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: number | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: number;
  updated_at: number;
  idempotency_key: string;
}

export interface SyncStateRow {
  key: string;
  value: string | null;
  updated_at: number;
}

export interface TombstoneRow {
  id: string;
  entity_type: string;
  entity_id: string;
  remote_id: string | null;
  deleted_at: number;
  synced: number;
}

export type SyncStateKey =
  | 'last_global_pull_at'
  | 'last_conversations_pull_at'
  | 'last_receipts_pull_at'
  | 'last_support_pull_at'
  | 'local_schema_version'
  | 'current_user_uid'
  | 'device_id'
  | 'legacy_queue_migrated';
