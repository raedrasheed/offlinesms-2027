import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqlJsDb, type CountingDb } from '../support/sqljsDb';
let db: CountingDb;
vi.mock('../../src/localdb/connection', () => ({ getDb: () => db }));
vi.mock('../../src/localdb/messageChanges', () => ({ emitLocalMessagesChanged: vi.fn() }));
import { applyRemoteMessages, listMessages } from '../../src/localdb/repositories/messagesRepo';
import { payloadFromRemote } from '../../src/lib/pollModel';
import { mapMessageRow } from '../../src/hooks/messageModel';
import { isStickerImage } from '../../src/media/stickerPresentation';
const media = { storagePath: 'chatMedia/c/peer/cat/image-original.png', downloadURL: 'https://example.test/cat.png',
  mimeType: 'image/png', width: 512, height: 512, sizeBytes: 1200, uploadStatus: 'uploaded' as const };
const remote = (id = 'cat', fileName?: string) => ({ remoteId: id, conversationId: 'c', senderUid: 'peer', type: 'image' as const,
  text: 'Photo', remoteCreatedAt: 1000, media, payload: payloadFromRemote('image', { media: { ...media, fileName } }) });
beforeEach(async () => { db = await createSqlJsDb(); });
afterEach(() => db.close());
describe('legacy sticker metadata in the local cache', () => {
  it('retains the legacy export filename through remote serialization, SQLite and rendering', async () => {
    await applyRemoteMessages([remote('cat', 'sticker-1234.png')]);
    const message = mapMessageRow((await listMessages('c'))[0]);
    expect(message.media?.fileName).toBe('sticker-1234.png'); expect(isStickerImage(message)).toBe(true);
  });
  it('repairs missing metadata from history without overwriting a newer caption or edit', async () => {
    await applyRemoteMessages([remote()]);
    await db.run("UPDATE messages SET text = 'Live text', caption = 'Live caption', edited_at = 2000 WHERE remote_id = 'cat'");
    await applyRemoteMessages([remote('cat', 'sticker-1234.png')], { insertOnly: true });
    const row = (await listMessages('c'))[0];
    expect(row).toMatchObject({ text: 'Live text', caption: 'Live caption', edited_at: 2000 });
    expect(mapMessageRow(row).media?.fileName).toBe('sticker-1234.png');
  });
  it('does not repair a different original or resurrect a deleted message', async () => {
    await applyRemoteMessages([remote()]);
    await applyRemoteMessages([{ ...remote('cat', 'sticker-1234.png'), media: { ...media, storagePath: 'other', downloadURL: 'https://example.test/other' } }], { insertOnly: true });
    expect(mapMessageRow((await listMessages('c'))[0]).media?.fileName).toBeNull();
    await applyRemoteMessages([{ ...remote(), deletedForEveryone: true }]);
    await applyRemoteMessages([remote('cat', 'sticker-1234.png')], { insertOnly: true });
    expect((await listMessages('c'))[0]).toMatchObject({ deleted_for_everyone: 1, payload_json: null, media_download_url: null });
  });
  it('preserves a newer known filename and sticker marker when old history arrives', async () => {
    const current = { ...remote('cat', 'sticker-current.png'), payload: JSON.stringify({ fileName: 'sticker-current.png', presentation: 'sticker' }) };
    await applyRemoteMessages([current]);
    await applyRemoteMessages([remote('cat', 'photo.png')], { insertOnly: true });
    expect(mapMessageRow((await listMessages('c'))[0]).media).toMatchObject({ fileName: 'sticker-current.png', presentation: 'sticker' });
  });
});
