# OfflineSMS — Local DB Schema (Phase 22)

On-device SQLite (`expo-sqlite`), namespaced per user as `offlinesms_<uid>.db`.
Source of truth: `apps/mobile/src/localdb/schema.ts`. Schema version tracked via
`PRAGMA user_version` and mirrored in `sync_state.local_schema_version`.
Booleans are `INTEGER` 0/1; timestamps are `INTEGER` epoch-ms.

## Conventions

- `local_*` columns hold device-generated values for instant UI; `remote_*`
  columns hold canonical server values. UI sorts by `remote_created_at` when
  present, otherwise `created_at`.
- `sync_status`: `synced | pending | dirty | conflict | deleted` (messages also
  use `failed`).
- Local ids: `local_msg_<deviceId>_<ts>_<rand>`; replaced by `remote_id` after
  the server confirms.

## Tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `conversations` | chat list rows + folded per-user state | `id`, `remote_id`, `type`, `last_message_at`, `unread_count`, `pinned/muted/favorite/archived`, `sync_status` |
| `messages` | message threads | `id`, `local_id`, `remote_id`, `conversation_id`, `status`, `created_at`/`remote_created_at`, `deleted_for_everyone/me`, `client_sequence`, `server_version`, `sync_status` |
| `message_reactions` | per-user reactions | unique `(message_id, emoji, user_uid)` |
| `message_receipts` | per-user receipt status | unique `(message_id, user_uid)`, monotonic `status` |
| `group_members` | group membership snapshots | unique `(conversation_id, uid)`, `role`, `status` |
| `outbox` | durable push queue | `type`, `payload_json`, `status`, `attempt_count`, `next_attempt_at`, unique `idempotency_key` |
| `sync_state` | cursors / ids | `last_*_pull_at`, `local_schema_version`, `current_user_uid`, `device_id` |
| `tombstones` | local deletes pending remote ack | `entity_type`, `entity_id`, `remote_id`, `synced` |

## Indexes

`conversations`: `last_message_at`, `type`, `unread`, `favorite`, `archived`.
`messages`: `(conversation_id, created_at)`, `(conversation_id, remote_created_at)`,
`sync_status`, `local_id`, `remote_id`.
`outbox`: `(status, next_attempt_at)`, `conversation_id`, `(entity_type, entity_id)`.

## Migrations

`migrations.ts` holds an ordered list of `{ version, up(exec) }`. `applyMigrations`
runs every migration above the current `user_version` in a transaction, then
bumps `user_version`. Migration 1 creates all tables + indexes.

## Privacy

No secrets in SQLite (no tokens/OTP/payment/webhook/admin secrets/keys). Phone
numbers stored masked where the UI requires. SQLCipher deferred (relies on OS
sandbox this phase). Logout wipes all `USER_DATA_TABLES` (keeps `device_id`).
