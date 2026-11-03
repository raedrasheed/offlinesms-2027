import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqlJsDb, type CountingDb } from '../support/sqljsDb';
let db: CountingDb;
vi.mock('../../src/localdb/connection', () => ({ getDb: () => db, getCurrentUid: () => 'me' }));
import { listConversations, upsertRemoteConversation } from '../../src/localdb/repositories/conversationsRepo';
import { applyRemoteMessages, deleteConversationMessages, listMessages } from '../../src/localdb/repositories/messagesRepo';
import { mapConversationRow } from '../../src/hooks/chatListModel';
import { isConversationVisible } from '../../src/lib/chatVisibility';

beforeEach(async () => { db = await createSqlJsDb(); });
afterEach(() => db.close());

describe('real SQLite direct-conversation visibility', () => {
  it('does not confuse an opened empty profile with a legacy chat containing cached messages', async () => {
    for (const id of ['empty', 'legacy']) await upsertRemoteConversation({ id, type: 'direct', last_message_preview: '', participant_key: 'me_peer' });
    await applyRemoteMessages([{ remoteId: 'legacy-message', conversationId: 'legacy', senderUid: 'peer', type: 'text', text: 'old history', remoteCreatedAt: 100 }]);
    const rows = (await listConversations()).map(row => mapConversationRow(row));
    expect(rows.filter(c => isConversationVisible(c)).map(c => c.id)).toEqual(['legacy']);
    expect(rows.find(c => c.id === 'legacy')).toMatchObject({ lastMessageId: 'legacy-message', participantKey: 'me_peer' });
  });
  it('retains the peer identity across profile-only writes for story rings and presence', async () => {
    await upsertRemoteConversation({ id: 'c', participant_key: 'me_peer', title: 'Old' });
    await upsertRemoteConversation({ id: 'c', title: 'New' });
    expect((await listConversations())[0]).toMatchObject({ title: 'New', participant_key: 'me_peer' });
  });
  it('keeps messages that arrive after the delete confirmation snapshot', async () => {
    await applyRemoteMessages([
      { remoteId: 'old', conversationId: 'c', senderUid: 'peer', type: 'text', text: 'old', remoteCreatedAt: 100 },
      { remoteId: 'new', conversationId: 'c', senderUid: 'peer', type: 'text', text: 'new', remoteCreatedAt: 101 },
    ]);
    expect(await deleteConversationMessages('c', 100)).toBe(1);
    expect((await listMessages('c')).map(m => m.remote_id)).toEqual(['new']);
  });
});
