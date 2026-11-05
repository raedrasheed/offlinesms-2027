import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ admin: vi.fn(), collection: vi.fn(), doc: vi.fn(), transaction: vi.fn(), storage: vi.fn() }));
vi.mock('../lib/clipAdminAuth', () => ({ requireClipsAdmin: mocks.admin }));
vi.mock('../lib/firebase-admin', () => ({ adminDb: { collection: mocks.collection, doc: mocks.doc, runTransaction: mocks.transaction } }));
vi.mock('firebase-admin/storage', () => ({ getStorage: mocks.storage }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: {}, FieldPath: {} }));
vi.mock('../lib/clipAdminPolicy', () => ({ adminReason: vi.fn(), clipVersion: vi.fn(), isClipDocumentId: vi.fn() }));
vi.mock('../lib/postAdminPolicy', () => ({ POST_STATUSES: ['published'], postModerationTarget: vi.fn(), validPostImagePath: vi.fn() }));
import { moderatePost, getAdminPostImage, resolvePostReport } from '../lib/postAdminActions';
import { getAdminPost, listAdminPosts, listOpenPostReports } from '../lib/postAdminData';
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue({ uid: 'admin', email: null }); });
describe('disabled dashboard Posts entry points', () => {
  it('blocks all reads and actions even for an authorized platform administrator', async () => {
    for (const read of [() => getAdminPost('old'), () => listAdminPosts('published'), () => listOpenPostReports()])
      await expect(read()).rejects.toThrow('Posts are disabled.');
    const decisions = [await moderatePost({ postId: 'old', version: '1', action: 'approve', reason: 'reviewed' }),
      await getAdminPostImage('old'), await resolvePostReport({ reportId: 'report', version: '1', decision: 'resolved', reason: 'reviewed' })];
    for (const result of decisions) expect(result).toEqual({ error: 'Posts are disabled.' });
    expect(mocks.collection).not.toHaveBeenCalled(); expect(mocks.doc).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.storage).not.toHaveBeenCalled();
  });
});
