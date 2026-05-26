// Phase 22 — group members repository.
import { getDb } from '../connection';
import { localId } from '../sync/ids';
import type { MemberRow, MemberRole, MemberStatus } from '../types';

export async function listMembers(conversationId: string): Promise<MemberRow[]> {
  return getDb().all<MemberRow>(
    `SELECT * FROM group_members WHERE conversation_id = ? AND status = 'active' ORDER BY role, display_name`,
    [conversationId],
  );
}

export async function upsertMember(m: {
  conversationId: string; uid: string; displayName?: string | null; photoUrl?: string | null;
  role?: MemberRole; status?: MemberStatus; joinedAt?: number | null;
}): Promise<void> {
  const now = Date.now();
  const existing = await getDb().first<MemberRow>(
    `SELECT id FROM group_members WHERE conversation_id = ? AND uid = ?`, [m.conversationId, m.uid]);
  if (existing) {
    await getDb().run(
      `UPDATE group_members SET display_name = COALESCE(?, display_name), photo_url = COALESCE(?, photo_url),
         role = COALESCE(?, role), status = COALESCE(?, status), updated_at = ?
       WHERE conversation_id = ? AND uid = ?`,
      [m.displayName ?? null, m.photoUrl ?? null, m.role ?? null, m.status ?? null, now, m.conversationId, m.uid],
    );
  } else {
    await getDb().run(
      `INSERT INTO group_members (id, conversation_id, uid, display_name, photo_url, role, status, joined_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [localId('member'), m.conversationId, m.uid, m.displayName ?? null, m.photoUrl ?? null,
       m.role ?? 'member', m.status ?? 'active', m.joinedAt ?? now, now],
    );
  }
}
