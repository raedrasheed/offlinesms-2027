import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createSqlJsDb, type CountingDb } from '../support/sqljsDb';
import { firestoreMock } from '../support/fakeFirestore';
const mock = vi.hoisted(() => ({ uid: 'me', recent: vi.fn(), target: vi.fn(), background: vi.fn() }));
let db: CountingDb;
vi.mock('../../src/localdb/connection', () => ({ getDb: () => db, getCurrentUid: () => mock.uid }));
vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: { get currentUser() { return { uid: mock.uid }; } } }));
vi.mock('firebase/firestore', () => ({ ...firestoreMock, getDocsFromServer: mock.background }));
vi.mock('../../src/localdb/sync/messageReads', () => ({ readRecentMessages: mock.recent, readMessageById: mock.target }));
import { pullMessages, pullRecentMessages, pullMessageById } from '../../src/localdb/sync/firebasePull';
import { applyRemoteMessages, listMessages } from '../../src/localdb/repositories/messagesRepo';
const message = { remoteId: 'new', conversationId: 'c', senderUid: 'peer', text: 'new', remoteCreatedAt: 100 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
beforeEach(async () => { db = await createSqlJsDb(); mock.uid = 'me'; vi.resetAllMocks(); });
afterEach(() => db.close());

describe('foreground message priority', () => {
  it('commits recent messages while the ordinary WebChannel catch-up is stalled', async () => {
    const background = deferred<any>();
    mock.background.mockReturnValue(background.promise);
    const catchUp = pullMessages('c');
    await vi.waitFor(() => expect(mock.background).toHaveBeenCalledOnce());
    mock.recent.mockResolvedValue([message]);
    await pullRecentMessages('c');
    expect((await listMessages('c'))[0].remote_id).toBe('new');
    background.resolve({ docs: [], size: 0 });
    await catchUp;
  });

  it('coalesces concurrent open/retry reads into one HTTP request', async () => {
    const request = deferred<any[]>();
    mock.recent.mockReturnValue(request.promise);
    const first = pullRecentMessages('c');
    const second = pullRecentMessages('c');
    expect(first).toBe(second);
    expect(mock.recent).toHaveBeenCalledOnce();
    request.resolve([message]);
    await Promise.all([first, second]);
    expect(await listMessages('c')).toHaveLength(1);
  });

  it('does not write a delayed response into a different signed-in account', async () => {
    const request = deferred<any[]>();
    mock.recent.mockReturnValue(request.promise);
    const read = pullRecentMessages('c');
    mock.uid = 'other';
    request.resolve([message]);
    await expect(read).rejects.toThrow('sync-session-changed');
    expect(await listMessages('c')).toHaveLength(0);
  });

  it('can retry a failed direct read without poisoning the single-flight guard', async () => {
    mock.recent.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([message]);
    await expect(pullRecentMessages('c')).rejects.toThrow('offline');
    await pullRecentMessages('c');
    expect(await listMessages('c')).toHaveLength(1);
  });

  it('does not reuse a previous login request when the same user reopens a different DB handle', async () => {
    const old = deferred<any[]>();
    mock.recent.mockReturnValueOnce(old.promise).mockResolvedValueOnce([message]);
    const first = pullRecentMessages('c');
    const previousDb = db;
    db = await createSqlJsDb();
    const second = pullRecentMessages('c');
    expect(second).not.toBe(first);
    await second;
    old.resolve([{ ...message, remoteId: 'old-session' }]);
    await expect(first).rejects.toThrow('sync-session-changed');
    expect((await listMessages('c')).map(r => r.remote_id)).toEqual(['new']);
    previousDb.close();
  });

  it('still completes a notified media message that was cached before the upload finished', async () => {
    await applyRemoteMessages([{ ...message, type: 'image', media: { uploadStatus: 'uploading' } }]);
    mock.target.mockResolvedValue({ ...message, type: 'image', media: { uploadStatus: 'uploaded', downloadURL: 'https://example.invalid/ready' } });
    expect(await pullMessageById('c', 'new')).toBe(true);
    expect((await listMessages('c'))[0]).toMatchObject({ media_upload_status: 'uploaded', media_download_url: 'https://example.invalid/ready' });
  });
});
