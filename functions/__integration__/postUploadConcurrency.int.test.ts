import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, expectHttps, req, resetEmulators, Timestamp } from './harness';

// Real authorization and Firestore transactions; only image bytes and external
// object storage are controlled so the late-upload race is deterministic.
const storage = vi.hoisted(() => ({
  objects: new Set<string>(), deleted: [] as string[], saved: [] as string[],
  beforeSave: null as null | ((path: string) => Promise<void>),
  afterSave: null as null | ((path: string) => Promise<void>),
}));
vi.mock('../src/social/postImages', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/social/postImages')>()),
  sanitizePostImage: async () => ({ bytes: Buffer.from('sanitized test JPEG'), digest: 'a'.repeat(64) }),
}));
vi.mock('firebase-admin/storage', () => ({ getStorage: () => ({ bucket: () => ({
  file: (path: string) => ({
    save: async () => { storage.saved.push(path); await storage.beforeSave?.(path); storage.objects.add(path); await storage.afterSave?.(path); },
    delete: async () => { storage.deleted.push(path); storage.objects.delete(path); },
    getSignedUrl: async () => [`https://example.invalid/private/${encodeURIComponent(path)}`],
  }),
}) }) }));
import { createPost, deletePost } from '../src/social/posts';

const clientId = 'same-upload';
const postId = createHash('sha256').update(`alice:${clientId}`).digest('hex');
const start = () => createPost.run(req('alice', { clientId, body: 'post', audience: 'public', imageBase64: '/9j/' }));

async function concurrentPost(imagePath: string) {
  storage.objects.add(imagePath);
  await db().doc(`posts/${postId}`).set({ ownerUid: 'alice', body: 'concurrent retry', audience: 'public',
    status: 'published', imagePath, createdAt: Timestamp.now(), publishedAt: Timestamp.now(), likeCount: 0, commentCount: 0 });
}
beforeEach(async () => {
  storage.objects.clear(); storage.deleted.length = 0; storage.saved.length = 0; storage.beforeSave = null; storage.afterSave = null;
  await resetEmulators();
  await db().doc('systemSettings/clips').set({ enabled: true, moderationRequired: false, termsVersion: 'clips-v1' });
  await db().doc('users/alice').set({ status: 'active', displayName: 'Alice', username: 'alice' });
  await db().doc('clipProfiles/alice').set({ termsVersion: 'clips-v1' });
});

describe('Post upload retries racing with removal', () => {
  it('cleans an unreferenced object when storage committed it but its upload acknowledgement was lost', async () => {
    storage.afterSave = async () => { throw new Error('storage-acknowledgement-lost'); };
    await expect(start()).rejects.toThrow('storage-acknowledgement-lost');
    const [path] = storage.saved;
    expect((await db().doc(`posts/${postId}`).get()).exists).toBe(false);
    expect(storage.objects.has(path)).toBe(false);
    expect(storage.deleted).toEqual([path]);
  });

  it.each([false, true])('removes a late recreated object after concurrent deletion (transaction rejects: %s)', async rejectTransaction => {
    storage.beforeSave = async savedPath => {
      await concurrentPost(savedPath);
      await deletePost.run(req('alice', { postId }));
      // The removal trigger already deleted the second request's object before
      // the first request finally completes its pending object-store upload.
      storage.objects.delete(savedPath);
      if (rejectTransaction) await db().doc('clipProfiles/alice').update({ suspended: true });
    };
    await expectHttps(start(), rejectTransaction ? 'permission-denied' : 'failed-precondition');
    const [path] = storage.saved;
    expect((await db().doc(`posts/${postId}`).get()).get('status')).toBe('removed');
    expect(storage.objects.has(path)).toBe(false);
    expect(storage.deleted).toContain(path);
  });

  it('preserves a concurrent successful retry and its referenced image', async () => {
    storage.beforeSave = async path => { await concurrentPost(path); };
    const result = await start();
    const [path] = storage.saved;
    expect(result.post).toMatchObject({ id: postId, body: 'concurrent retry', status: 'published' });
    expect(storage.objects.has(path)).toBe(true);
    expect(storage.deleted).toEqual([]);
  });

  it('cleans only a redundant upload when a concurrent retry committed different bytes', async () => {
    const winnerPath = `postMedia/alice/${postId}/${'b'.repeat(64)}.jpg`;
    storage.beforeSave = async () => { await concurrentPost(winnerPath); };
    const result = await start();
    const [path] = storage.saved;
    expect(result.post.id).toBe(postId);
    expect(storage.objects.has(path)).toBe(false);
    expect(storage.objects.has(winnerPath)).toBe(true);
    expect(storage.deleted).toEqual([path]);
  });

  it('uses distinct objects for overlapping retries so a failed attempt cannot delete the successful attempt', async () => {
    let releaseFirst!: () => void, notifyFirst!: () => void;
    const firstSave = new Promise<void>(resolve => { notifyFirst = resolve; });
    const proceed = new Promise<void>(resolve => { releaseFirst = resolve; });
    let firstPath = '';
    storage.beforeSave = async path => {
      if (!firstPath) { firstPath = path; notifyFirst(); await proceed; }
    };
    storage.afterSave = async path => { if (path === firstPath) throw new Error('first-upload-acknowledgement-lost'); };
    // Handle rejection immediately, even if the second request fails early.
    const failed = start().then(() => null, error => error);
    await firstSave;
    try {
      const winner = await start();
      const winnerPath = (await db().doc(`posts/${winner.post.id}`).get()).get('imagePath');
      expect(winnerPath).not.toBe(firstPath);
      expect(storage.saved).toHaveLength(2);
      releaseFirst();
      expect((await failed)?.message).toBe('first-upload-acknowledgement-lost');
      expect(storage.objects.has(firstPath)).toBe(false);
      expect(storage.objects.has(winnerPath)).toBe(true);
      expect(storage.deleted).toEqual([firstPath]);
    } finally { releaseFirst(); await failed; }
  });
});
