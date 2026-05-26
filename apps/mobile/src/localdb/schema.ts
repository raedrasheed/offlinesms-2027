// Phase 22 — SQLite DDL for the local-first data layer.
//
// Pure strings (no native import) so migrations.ts can apply them and tests can
// assert on them. Booleans are stored as INTEGER 0/1; timestamps as INTEGER ms.

export const SCHEMA_VERSION = 1;

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
];

export const ALL_TABLE_STATEMENTS = [
  CREATE_CONVERSATIONS,
  CREATE_MESSAGES,
  CREATE_MESSAGE_REACTIONS,
  CREATE_MESSAGE_RECEIPTS,
  CREATE_GROUP_MEMBERS,
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
  'outbox',
  'tombstones',
];
