// Exercise the actual installed React Native Lite transport, not a query mock.
// HTTP is intercepted so this never reads/writes a real Firebase project.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/firebase', async () => {
  const { initializeApp } = await import('firebase/app');
  return { app: initializeApp({ projectId: 'demo-message-reads', apiKey: 'fixture-key', appId: 'fixture-app' }, 'message-reads') };
});
vi.mock('firebase/firestore/lite', async () => {
  // @ts-expect-error The SDK publishes declarations for its API, not this native entry file.
  const sdk = await import('../node_modules/@firebase/firestore/dist/lite/index.rn.esm2017.js');
  return { ...sdk, getFirestore: (app: any) => {
    const db = sdk.getFirestore(app);
    sdk.connectFirestoreEmulator(db, 'localhost', 8080, { mockUserToken: { sub: 'fixture-user' } });
    return db;
  } };
});

const http = vi.fn();
let reads: typeof import('../src/localdb/sync/messageReads');
const document = {
  name: 'projects/demo-message-reads/databases/(default)/documents/conversations/c/messages/new',
  fields: { text: { stringValue: 'new message' }, senderUid: { stringValue: 'peer' },
    createdAt: { timestampValue: '2026-10-15T08:00:00.123456Z' } },
  createTime: '2026-10-15T08:00:00Z', updateTime: '2026-10-15T08:00:00Z',
};
beforeAll(async () => {
  vi.stubGlobal('fetch', http);
  reads = await import('../src/localdb/sync/messageReads');
});
beforeEach(() => { http.mockReset(); });
afterAll(() => { vi.unstubAllGlobals(); });

describe('foreground REST transport', () => {
  it('fetches a bounded newest page using one authenticated runQuery, without a Listen channel', async () => {
    http.mockResolvedValue({ ok: true, json: async () => [{ document }] });
    const messages = await reads.readRecentMessages('c');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ remoteId: 'new', text: 'new message', remoteCreatedAt: 1792051200123.456 });
    expect(http).toHaveBeenCalledOnce();
    const [url, options] = http.mock.calls[0];
    expect(url).toBe('http://localhost:8080/v1/projects/demo-message-reads/databases/(default)/documents/conversations/c:runQuery');
    expect(options.headers.Authorization).toMatch(/^Bearer /);
    expect(JSON.parse(options.body).structuredQuery).toMatchObject({
      from: [{ collectionId: 'messages' }], limit: 25,
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' },
        { field: { fieldPath: '__name__' }, direction: 'DESCENDING' }],
    });
  });

  it('fetches a notification document directly and preserves the media fields', async () => {
    http.mockResolvedValue({ ok: true, json: async () => [{ found: { ...document, fields: {
      ...document.fields, type: { stringValue: 'image' },
      media: { mapValue: { fields: { uploadStatus: { stringValue: 'uploaded' }, downloadURL: { stringValue: 'https://example.invalid/photo' } } } },
    } } }] });
    const message = await reads.readMessageById('c', 'new');
    expect(message).toMatchObject({ type: 'image', media: { uploadStatus: 'uploaded', downloadURL: 'https://example.invalid/photo' } });
    expect(http.mock.calls[0][0]).toContain(':batchGet');
    expect(JSON.parse(http.mock.calls[0][1].body).documents).toEqual([document.name]);
  });

  it('propagates permission errors without treating an unauthorized read as an empty chat', async () => {
    http.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { message: 'fixture denied' } }) });
    await expect(reads.readRecentMessages('c')).rejects.toMatchObject({ code: 'permission-denied' });
    expect(http).toHaveBeenCalledOnce();
  });
});
