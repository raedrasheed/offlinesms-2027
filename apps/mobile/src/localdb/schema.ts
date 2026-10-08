// Phase 22 — SQLite DDL for the local-first data layer.
//
// Pure strings (no native import) so migrations.ts can apply them and tests can
// assert on them. Booleans are stored as INTEGER 0/1; timestamps as INTEGER ms.

export const SCHEMA_VERSION = 7;

// Phase 22C — columns added to `messages` in migration v2 (ALTER, applied on
// top of the v1 CREATE so existing installs upgrade cleanly).
export const MESSAGES_V2_COLUMNS = [
  `ALTER TABLE messages ADD COLUMN reactions_json TEXT;`,
  `ALTER TABLE messages ADD COLUMN delivered_count INTEGER DEFAULT 0;`,
  `ALTER TABLE messages ADD COLUMN read_count INTEGER DEFAULT 0;`,
  `ALTER TABLE messages ADD COLUMN viewed_count INTEGER DEFAULT 0;`,
  `ALTER TABLE messages ADD COLUMN played_count INTEGER DEFAULT 0;`,
];

// Phase 23 — media (image/voice) columns on `messages`. Binary lives in
// Firebase Storage; these hold metadata + local upload state only.
export const MESSAGES_V3_COLUMNS = [
  `ALTER TABLE messages ADD COLUMN caption TEXT;`,
  `ALTER TABLE messages ADD COLUMN media_local_uri TEXT;`,
  `ALTER TABLE messages ADD COLUMN media_mime TEXT;`,
  `ALTER TABLE messages ADD COLUMN media_size INTEGER;`,
  `ALTER TABLE messages ADD COLUMN media_width INTEGER;`,
  `ALTER TABLE messages ADD COLUMN media_height INTEGER;`,
  `ALTER TABLE messages ADD COLUMN media_duration_ms INTEGER;`,
  `ALTER TABLE messages ADD COLUMN media_waveform TEXT;`,
  `ALTER TABLE messages ADD COLUMN media_storage_path TEXT;`,
  `ALTER TABLE messages ADD COLUMN media_download_url TEXT;`,
  `ALTER TABLE messages ADD COLUMN media_thumb_path TEXT;`,
  `ALTER TABLE messages ADD COLUMN media_thumb_url TEXT;`,
  `ALTER TABLE messages ADD COLUMN media_upload_status TEXT;`,
  `ALTER TABLE messages ADD COLUMN media_upload_progress REAL DEFAULT 0;`,
];

export const CREATE_CONVERSATIONS = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  remote_id TEXT UNIQUE,
  type TEXT NOT NULL,
  title TEXT,
  avatar_url TEXT,
  participant_key TEXT,
  owner_uid TEXT,
  status TEXT DEFAULT 'active',
  member_count INTEGER DEFAULT 0,
  pinned_message_id TEXT,
  last_message_id TEXT,
  last_message_preview TEXT,
  last_message_at INTEGER,
  unread_count INTEGER DEFAULT 0,
  muted INTEGER DEFAULT 0,
  pinned INTEGER DEFAULT 0,
  favorite INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  local_updated_at INTEGER,
  remote_updated_at INTEGER,
  sync_status TEXT DEFAULT 'synced'
);`;

export const CREATE_MESSAGES = `
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  local_id TEXT UNIQUE,
  remote_id TEXT UNIQUE,
  conversation_id TEXT NOT NULL,
  sender_uid TEXT NOT NULL,
  sender_display_name TEXT,
  type TEXT NOT NULL DEFAULT 'text',
  text TEXT,
  preview TEXT,
  created_at INTEGER,
  remote_created_at INTEGER,
  updated_at INTEGER,
  edited_at INTEGER,
  deleted_for_everyone INTEGER DEFAULT 0,
  deleted_for_me INTEGER DEFAULT 0,
  deleted_at INTEGER,
  reply_to_message_id TEXT,
  reply_to_preview TEXT,
  forwarded INTEGER DEFAULT 0,
  forwarded_from_message_id TEXT,
  status TEXT DEFAULT 'pending',
  error_code TEXT,
  error_message TEXT,
  sync_status TEXT DEFAULT 'pending',
  client_sequence INTEGER DEFAULT 0,
  server_version INTEGER DEFAULT 0
);`;

export const CREATE_MESSAGE_REACTIONS = `
CREATE TABLE IF NOT EXISTS message_reactions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  user_uid TEXT NOT NULL,
  created_at INTEGER,
  sync_status TEXT DEFAULT 'synced',
  UNIQUE(message_id, emoji, user_uid)
);`;

export const CREATE_MESSAGE_RECEIPTS = `
CREATE TABLE IF NOT EXISTS message_receipts (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  user_uid TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  delivered_at INTEGER,
  read_at INTEGER,
  viewed_at INTEGER,
  played_at INTEGER,
  failed_at INTEGER,
  sync_status TEXT DEFAULT 'synced',
  UNIQUE(message_id, user_uid)
);`;

export const CREATE_GROUP_MEMBERS = `
CREATE TABLE IF NOT EXISTS group_members (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  display_name TEXT,
  photo_url TEXT,
  role TEXT DEFAULT 'member',
  status TEXT DEFAULT 'active',
  joined_at INTEGER,
  updated_at INTEGER,
  UNIQUE(conversation_id, uid)
);`;

// Phase 25 — external phone-only group members (migration v4). Mirrors the
// Firestore conversations/{id}/externalMembers subcollection for offline-first
// display; `pending` marks rows added optimistically while offline.
export const CREATE_EXTERNAL_MEMBERS = `
CREATE TABLE IF NOT EXISTS external_members (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  display_name TEXT,
  phone_e164 TEXT,
  normalized_phone TEXT,
  is_registered INTEGER DEFAULT 0,
  linked_uid TEXT,
  pending INTEGER DEFAULT 0,
  updated_at INTEGER,
  UNIQUE(conversation_id, contact_id)
);`;

export const CREATE_OUTBOX = `
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  conversation_id TEXT,
  payload_json TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  attempt_count INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 8,
  next_attempt_at INTEGER,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  idempotency_key TEXT UNIQUE
);`;

export const CREATE_SYNC_STATE = `
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER
);`;

export const CREATE_TOMBSTONES = `
CREATE TABLE IF NOT EXISTS tombstones (
  id TEXT PRIMARY KEY,
  entity_type TEXT,
  entity_id TEXT,
  remote_id TEXT,
  deleted_at INTEGER,
  synced INTEGER DEFAULT 0
);`;

export const CREATE_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON conversations(last_message_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(type);`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_unread ON conversations(unread_count);`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_favorite ON conversations(favorite);`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_archived ON conversations(archived);`,
  `CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS idx_messages_conversation_remote_created ON messages(conversation_id, remote_created_at);`,
  `CREATE INDEX IF NOT EXISTS idx_messages_sync_status ON messages(sync_status);`,
  `CREATE INDEX IF NOT EXISTS idx_messages_local_id ON messages(local_id);`,
  `CREATE INDEX IF NOT EXISTS idx_messages_remote_id ON messages(remote_id);`,
  `CREATE INDEX IF NOT EXISTS idx_outbox_status_next_attempt ON outbox(status, next_attempt_at);`,
  `CREATE INDEX IF NOT EXISTS idx_outbox_conversation ON outbox(conversation_id);`,
  `CREATE INDEX IF NOT EXISTS idx_outbox_entity ON outbox(entity_type, entity_id);`,
  `CREATE INDEX IF NOT EXISTS idx_external_members_conversation ON external_members(conversation_id);`,
];

// v4 — create the external_members table on existing installs.
export const EXTERNAL_MEMBERS_V4 = [
  CREATE_EXTERNAL_MEMBERS,
  `CREATE INDEX IF NOT EXISTS idx_external_members_conversation ON external_members(conversation_id);`,
];

// v5 — richer reply snapshot (sender uid/name/type so optimistic local replies
// render correctly before the server pull) + @mention metadata. All nullable /
// backward-compatible ALTERs applied on top of existing installs.
export const MESSAGES_V5_COLUMNS = [
  `ALTER TABLE messages ADD COLUMN reply_to_sender_uid TEXT;`,
  `ALTER TABLE messages ADD COLUMN reply_to_sender_name TEXT;`,
  `ALTER TABLE messages ADD COLUMN reply_to_type TEXT;`,
  `ALTER TABLE messages ADD COLUMN mentions_json TEXT;`,
];

// v6 — read-path indexes (performance). The conversation screen orders by the
// canonical time expression below and the chat list by last_message_at; without
// matching indexes SQLite sorted every row of the conversation (or the whole
// chat list) in a temporary B-tree on each open and each refresh. The ORDER BY
// in messagesRepo.listMessages / conversationsRepo.listConversations must use
// exactly these expressions for SQLite to pick the indexes.
export const MESSAGE_ORDER_EXPR = 'COALESCE(remote_created_at, created_at)';
export const READ_PATH_INDEXES_V6 = [
  `CREATE INDEX IF NOT EXISTS idx_messages_conv_visible_order ON messages(conversation_id, deleted_for_me, ${MESSAGE_ORDER_EXPR});`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_archived_last ON conversations(archived, last_message_at);`,
];

// v7 — typed message payloads (sticker reference / poll definition + votes),
// stored as JSON so new message kinds need no further columns.
export const MESSAGES_V7_COLUMNS = [
  `ALTER TABLE messages ADD COLUMN payload_json TEXT;`,
];

export const ALL_TABLE_STATEMENTS = [
  CREATE_CONVERSATIONS,
  CREATE_MESSAGES,
  CREATE_MESSAGE_REACTIONS,
  CREATE_MESSAGE_RECEIPTS,
  CREATE_GROUP_MEMBERS,
  CREATE_EXTERNAL_MEMBERS,
  CREATE_OUTBOX,
  CREATE_SYNC_STATE,
  CREATE_TOMBSTONES,
];

/** Tables that hold per-user data and must be cleared on logout / uid change. */
export const USER_DATA_TABLES = [
  'conversations',
  'messages',
  'message_reactions',
  'message_receipts',
  'group_members',
  'external_members',
  'outbox',
  'tombstones',
];
