// Phase 25 — external phone-only group members repository (local mirror).
import { getDb } from '../connection';
import { localId } from '../sync/ids';
import { toExternalMemberView, type ExternalMemberRow, type ExternalMemberView } from './externalMembersModel';

export { toExternalMemberView };
export type { ExternalMemberRow, ExternalMemberView };

export async function listExternalMembers(conversationId: string): Promise<ExternalMemberView[]> {
  const rows = await getDb().all<ExternalMemberRow>(
    `SELECT * FROM external_members WHERE conversation_id = ? ORDER BY display_name`,
    [conversationId],
  );
  return rows.map(toExternalMemberView);
}

export async function upsertExternalMember(m: {
  conversationId: string; contactId: string; displayName: string; phoneE164: string;
  normalizedPhone: string; isRegistered?: boolean; linkedUid?: string | null; pending?: boolean;
}): Promise<void> {
  const now = Date.now();
  const existing = await getDb().first<{ id: string }>(
    `SELECT id FROM external_members WHERE conversation_id = ? AND contact_id = ?`,
    [m.conversationId, m.contactId],
  );
  if (existing) {
    await getDb().run(
      `UPDATE external_members SET display_name = ?, phone_e164 = ?, normalized_phone = ?,
         is_registered = ?, linked_uid = ?, pending = ?, updated_at = ?
       WHERE conversation_id = ? AND contact_id = ?`,
      [m.displayName, m.phoneE164, m.normalizedPhone, m.isRegistered ? 1 : 0,
       m.linkedUid ?? null, m.pending ? 1 : 0, now, m.conversationId, m.contactId],
    );
  } else {
    await getDb().run(
      `INSERT INTO external_members
         (id, conversation_id, contact_id, display_name, phone_e164, normalized_phone, is_registered, linked_uid, pending, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [localId('ext'), m.conversationId, m.contactId, m.displayName, m.phoneE164, m.normalizedPhone,
       m.isRegistered ? 1 : 0, m.linkedUid ?? null, m.pending ? 1 : 0, now],
    );
  }
}

export async function removeExternalMember(conversationId: string, contactId: string): Promise<void> {
  await getDb().run(
    `DELETE FROM external_members WHERE conversation_id = ? AND contact_id = ?`,
    [conversationId, contactId],
  );
}

/** Replace the whole external roster for a conversation from a remote snapshot,
 *  preserving any still-pending optimistic rows not yet confirmed by the server. */
export async function replaceFromRemote(conversationId: string, remote: Array<{
  contactId: string; displayName: string; phoneE164: string; normalizedPhone: string;
  isRegistered: boolean; linkedUid: string | null;
}>): Promise<void> {
  const db = getDb();
  const remoteIds = new Set(remote.map(r => r.contactId));
  const local = await db.all<ExternalMemberRow>(
    `SELECT contact_id, pending FROM external_members WHERE conversation_id = ?`, [conversationId]);
  // Delete local rows the server no longer has, UNLESS they're still pending.
  for (const r of local) {
    if (!remoteIds.has(r.contact_id) && r.pending !== 1) {
      await removeExternalMember(conversationId, r.contact_id);
    }
  }
  for (const r of remote) {
    await upsertExternalMember({ ...r, conversationId, pending: false });
  }
}
