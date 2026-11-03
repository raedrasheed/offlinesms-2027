// Phase 22 — conversations repository.
//
// The chat list reads from here. List query is a single indexed scan ordered by
// last_message_at; no per-row JSON parsing.

import { getDb, type LocalDatabase } from '../connection';
import type { ConversationRow, SyncStatus } from '../types';

export interface ConversationListFilter {
  unreadOnly?: boolean;
  favoritesOnly?: boolean;
  groupsOnly?: boolean;
  includeArchived?: boolean;
  search?: string;
}

export async function listConversations(filter: ConversationListFilter = {}): Promise<ConversationRow[]> {
  const where: string[] = [];
  const params: any[] = [];
  if (filter.unreadOnly) where.push('unread_count > 0');
  if (filter.favoritesOnly) where.push('favorite = 1');
  if (filter.groupsOnly) where.push(`type = 'group'`);
  if (!filter.includeArchived) where.push('archived = 0');
  if (filter.search && filter.search.trim()) {
    where.push('LOWER(title) LIKE ?');
    params.push(`%${filter.search.trim().toLowerCase()}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const database = getDb();
  const rows = await database.all<ConversationRow>(
    `SELECT * FROM conversations ${clause} ORDER BY last_message_at DESC NULLS LAST`,
    params,
  );
  // Old installs can have message history without a parent summary. Inspect
  // these candidates in one indexed SQL query before treating them as empty.
  const missing = rows.filter(c => c.type === 'direct' && !c.last_message_id && !c.last_message_preview);
  if (missing.length) {
    const evidence = await database.all<{ conversation_id: string; message_id: string; created_at: number; preview: string | null }>(
      `SELECT c.id AS conversation_id, COALESCE(m.remote_id, m.local_id, m.id) AS message_id,
              m.created_at, m.preview
       FROM conversations c JOIN messages m ON m.id = (
         SELECT id FROM messages WHERE conversation_id = c.id AND deleted_for_me = 0
         ORDER BY created_at DESC, id DESC LIMIT 1
       ) WHERE c.id IN (${missing.map(() => '?').join(',')})`,
      missing.map(c => c.id),
    );
    const byId = new Map(evidence.map(m => [m.conversation_id, m]));
    for (const row of missing) {
      const message = byId.get(row.id);
      if (!message) continue;
      row.last_message_id = message.message_id;
      row.last_message_preview = message.preview;
      row.last_message_at = message.created_at;
    }
  }
  return rows;
}

export async function getConversation(id: string, database: LocalDatabase = getDb()): Promise<ConversationRow | null> {
  return database.first<ConversationRow>(`SELECT * FROM conversations WHERE id = ? OR remote_id = ?`, [id, id]);
}

export async function countConversations(includeArchived = true): Promise<number> {
  const clause = includeArchived ? '' : 'WHERE archived = 0';
  const row = await getDb().first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM conversations ${clause}`,
  );
  return row?.n ?? 0;
}

export async function countUnreadConversations(): Promise<number> {
  const row = await getDb().first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM conversations WHERE unread_count > 0 AND archived = 0`,
  );
  return row?.n ?? 0;
}

/**
 * Upsert a conversation pulled from the remote backend. Local-only flags
 * (muted/pinned/favorite/archived/unread_count) are preserved unless the caller
 * explicitly provides them, since those live in per-user state.
 */
export async function upsertRemoteConversation(c: Partial<ConversationRow> & { id: string }, database: LocalDatabase = getDb()): Promise<void> {
  const existing = await getConversation(c.id, database);
  const now = Date.now();
  if (existing) {
    await database.run(
      `UPDATE conversations SET
        remote_id = COALESCE(?, remote_id),
        type = COALESCE(?, type),
        title = COALESCE(?, title),
        avatar_url = COALESCE(?, avatar_url),
        participant_key = COALESCE(?, participant_key),
        owner_uid = COALESCE(?, owner_uid),
        status = COALESCE(?, status),
        member_count = COALESCE(?, member_count),
        pinned_message_id = ?,
        last_message_id = COALESCE(?, last_message_id),
        last_message_preview = COALESCE(?, last_message_preview),
        last_message_at = COALESCE(?, last_message_at),
        remote_updated_at = COALESCE(?, remote_updated_at),
        sync_status = 'synced'
       WHERE id = ?`,
      [
        c.remote_id ?? null, c.type ?? null, c.title ?? null, c.avatar_url ?? null, c.participant_key ?? null,
        c.owner_uid ?? null, c.status ?? null, c.member_count ?? null,
        c.pinned_message_id ?? null, c.last_message_id ?? null,
        c.last_message_preview ?? null, c.last_message_at ?? null,
        c.remote_updated_at ?? now, c.id,
      ],
    );
  } else {
    await database.run(
      `INSERT INTO conversations
        (id, remote_id, type, title, avatar_url, participant_key, owner_uid, status, member_count,
         pinned_message_id, last_message_id, last_message_preview, last_message_at,
         unread_count, muted, pinned, favorite, archived, local_updated_at, remote_updated_at, sync_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'synced')`,
      [
        c.id, c.remote_id ?? c.id, c.type ?? 'direct', c.title ?? null, c.avatar_url ?? null, c.participant_key ?? null,
        c.owner_uid ?? null, c.status ?? 'active', c.member_count ?? 0,
        c.pinned_message_id ?? null, c.last_message_id ?? null, c.last_message_preview ?? null,
        c.last_message_at ?? null, c.unread_count ?? 0, c.muted ?? 0, c.pinned ?? 0,
        c.favorite ?? 0, c.archived ?? 0, now, c.remote_updated_at ?? now,
      ],
    );
  }
}

/** Apply a batch of remote conversation changes in ONE transaction. */
export async function applyRemoteConversations(batch: Array<Partial<ConversationRow> & { id: string }>): Promise<void> {
  if (batch.length === 0) return;
  await getDb().transaction(async tx => {
    for (const c of batch) await upsertRemoteConversation(c, tx);
  });
}

/** Apply per-user state (unread/pinned/muted/favorite/archived) for a conversation. */
export async function applyUserState(
  id: string,
  state: Partial<Pick<ConversationRow, 'unread_count' | 'muted' | 'pinned' | 'favorite' | 'archived' | 'last_message_preview' | 'last_message_at'>>,
): Promise<void> {
  const sets: string[] = [];
  const params: any[] = [];
  for (const [k, v] of Object.entries(state)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    params.push(v);
  }
  if (!sets.length) return;
  params.push(id);
  await getDb().run(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function setSyncStatus(id: string, status: SyncStatus): Promise<void> {
  await getDb().run(`UPDATE conversations SET sync_status = ? WHERE id = ?`, [status, id]);
}
