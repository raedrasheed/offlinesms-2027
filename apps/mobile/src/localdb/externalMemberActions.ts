import type { LocalDatabase } from './connection';
import type { OutboxRow } from './types';
import { enqueue } from './repositories/outboxRepo';
import { upsertExternalMember, removeExternalMember } from './repositories/externalMembersRepo';
import { localId } from './sync/ids';

type Change = { conversationId: string; contactId: string } & (
  { action: 'add'; displayName: string; phoneE164: string; defaultCountry?: string } |
  { action: 'remove' }
);

/** One durable user intent, rather than one lifetime add/remove key per phone.
 * Pending duplicates coalesce; explicit retries revive failed jobs, and a new
 * add/remove cycle gets a new operation without replaying another group's job. */
export async function stageExternalMemberChange(db: LocalDatabase, change: Change): Promise<void> {
  await db.transaction(async tx => {
    const type = change.action === 'add' ? 'add_external_contact_to_group' : 'remove_external_contact_from_group';
    const previous = await tx.first<OutboxRow>(
      `SELECT * FROM outbox WHERE conversation_id = ? AND entity_id = ?
       AND type IN ('add_external_contact_to_group','remove_external_contact_from_group')
       ORDER BY created_at DESC, rowid DESC LIMIT 1`, [change.conversationId, change.contactId]);
    const payload = change.action === 'add' ? {
      conversationId: change.conversationId, displayName: change.displayName,
      phoneNumber: change.phoneE164, defaultCountry: change.defaultCountry,
    } : { conversationId: change.conversationId, contactId: change.contactId };

    if (previous?.type === type && previous.status !== 'completed') {
      // A worker already owns a processing row. Never alter its payload or
      // lease while a network request may still be running.
      if (previous.status !== 'processing') {
        await tx.run(`UPDATE outbox SET payload_json = ?, status = 'pending', attempt_count = 0,
          next_attempt_at = ?, last_error_code = NULL, last_error_message = NULL, updated_at = ? WHERE id = ?`,
        [JSON.stringify(payload), Date.now(), Date.now(), previous.id]);
      }
    } else {
      const row = await enqueue({ type, entityType: 'externalMember', entityId: change.contactId,
        conversationId: change.conversationId, payload, idempotencyKey: localId('external_intent') }, tx);
      // Even taps in the same millisecond preserve add/remove order.
      if (previous && row.created_at <= previous.created_at) await tx.run(
        'UPDATE outbox SET created_at = ? WHERE id = ?', [previous.created_at + 1, row.id]);
    }
    if (change.action === 'add') await upsertExternalMember({
      conversationId: change.conversationId, contactId: change.contactId,
      displayName: change.displayName, phoneE164: change.phoneE164,
      normalizedPhone: change.contactId, isRegistered: false, pending: true,
    }, tx);
    else await removeExternalMember(change.conversationId, change.contactId, tx);
  });
}
