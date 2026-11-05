// Archive behavior coverage; the real disabled gate is tested separately.
vi.mock('../lib/postsFeature', () => ({ assertPostsEnabled: () => {} }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ session: { state: 'unauthenticated' } as any,
  docs: new Map<string, { data: Record<string, any>; version: number }>(),
  writes: [] as Array<{ path: string; data: Record<string, any> }>, reads: 0, serial: 0, failAudit: false,
  signed: [] as Array<{ path: string; options: any }>, queries: [] as any[],
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'verified-cookie' }) }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/session', () => ({ verifySession: async () => state.session }));
vi.mock('firebase-admin/storage', () => ({ getStorage: () => ({ bucket: () => ({ file: (path: string) => ({
  getSignedUrl: async (options: any) => { state.signed.push({ path, options }); return ['https://signed.invalid/private']; },
}) }) }) }));
vi.mock('../lib/firebase-admin', () => {
  const snapshot = (ref: any) => {
    state.reads++; const row = state.docs.get(ref.path);
    return { exists: !!row, ref, id: ref.id, data: () => row?.data, get: (field: string) => row?.data[field],
      updateTime: row ? { seconds: row.version, nanoseconds: 0 } : undefined };
  };
  const doc = (path: string): any => ({ path, id: path.split('/').pop(), collection: (name: string) => collection(`${path}/${name}`), get: async () => snapshot(doc(path)) });
  const query = (path: string, filter?: any[], anchor?: string, max = 1000): any => ({
    where: (...next: any[]) => query(path, next, anchor, max), orderBy: () => query(path, filter, anchor, max),
    startAfter: (row: any) => query(path, filter, row.id, max), limit: (count: number) => query(path, filter, anchor, count),
    get: async () => {
      state.queries.push({ path, filter, anchor, max });
      let rows = [...state.docs.entries()].filter(([key, row]) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1 && (!filter || row.data[filter[0]] === filter[2]))
        .map(([key]) => snapshot(doc(key))).sort((a, b) => (b.get('createdAt')?.toMillis?.() ?? 0) - (a.get('createdAt')?.toMillis?.() ?? 0) || b.id.localeCompare(a.id));
      if (anchor) rows = rows.slice(rows.findIndex(row => row.id === anchor) + 1);
      const docs = rows.slice(0, max); return { docs, size: docs.length };
    },
  });
  const collection = (path: string): any => ({ ...query(path), doc: (id?: string) => doc(`${path}/${id ?? `auto-${++state.serial}`}`),
    add: async (data: any) => { if (state.failAudit && path === 'auditLogs') throw new Error('Audit unavailable'); state.writes.push({ path: `${path}/auto-${++state.serial}`, data }); },
  });
  return { adminDb: { collection, doc, getAll: async (...refs: any[]) => refs.map(snapshot),
    runTransaction: async (callback: any) => {
      const pending: any[] = [];
      await callback({
        get: async (ref: any) => { if (pending.length) throw new Error('read-after-write'); return snapshot(ref); },
        getAll: async (...refs: any[]) => { if (pending.length) throw new Error('read-after-write'); return refs.map(snapshot); },
        update: (ref: any, data: any) => pending.push({ path: ref.path, data, merge: true }),
        create: (ref: any, data: any) => { if (state.failAudit && ref.path.startsWith('auditLogs/')) throw new Error('Audit unavailable'); pending.push({ path: ref.path, data }); },
      });
      for (const write of pending) {
        const old = state.docs.get(write.path);
        state.docs.set(write.path, { data: { ...(write.merge ? old?.data : {}), ...write.data }, version: (old?.version ?? 0) + 1 }); state.writes.push(write);
      }
    },
  } };
});
import { moderatePost, getAdminPostImage, resolvePostReport } from '../lib/postAdminActions';
import { getAdminPost, listAdminPosts, listOpenPostReports } from '../lib/postAdminData';
import { validPostImagePath } from '../lib/postAdminPolicy';
const imagePath = `postMedia/creator/post/${'a'.repeat(64)}.jpg`;
const decision = { postId: 'post', version: '1:0', action: 'approve' as const, reason: 'Reviewed and suitable' };
const reportDecision = { reportId: 'report', version: '1:0', decision: 'resolved' as const, reason: 'Report reviewed and addressed' };
function put(path: string, data: Record<string, any>, version = 1) { state.docs.set(path, { data, version }); }
function seed(extra: Record<string, any> = {}) {
  put('posts/post', { ownerUid: 'creator', body: 'Hello', status: 'pending_review', audience: 'public', imagePath, ...extra });
  put('users/creator', { status: 'active' });
}
beforeEach(() => {
  state.session = { state: 'authorized', role: 'super_admin', user: { uid: 'admin', email: 'admin@example.com', claims: { role: 'super_admin' } } };
  state.docs.clear(); state.writes = []; state.reads = 0; state.serial = 0; state.failAudit = false; state.signed = []; state.queries = [];
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'private-test-bucket';
});
describe('Posts administrative authorization', () => {
  it('rejects every entry point before reading or signing for non-platform roles', async () => {
    const sessions = [{ state: 'unauthenticated' }, ...['organization_admin', 'support_agent', 'finance_admin', 'auditor', 'bootstrap_admin'].map(role => ({ state: 'authorized', role, user: { uid: 'restricted', claims: { role } } })),
      { state: 'authorized', role: 'legacy_admin', user: { uid: 'org', claims: { admin: true, role: 'organization_admin' } } },
      { state: 'authorized', role: 'legacy_admin', user: { uid: 'org', claims: { admin: true, organizationId: 'other-org' } } }];
    for (const session of sessions) {
      state.session = session;
      for (const read of [() => getAdminPost('post'), () => listAdminPosts('pending_review'), () => listOpenPostReports()]) await expect(read()).rejects.toThrow('Platform administrator');
      for (const result of [await moderatePost(decision), await getAdminPostImage('post'), await resolvePostReport(reportDecision)]) expect(result).toHaveProperty('error');
    }
    expect(state.reads).toBe(0); expect(state.writes).toEqual([]); expect(state.signed).toEqual([]);
  });
});
describe('Posts moderation', () => {
  it('approves a current post and writes its audit in the same transaction', async () => {
    seed(); expect(await moderatePost(decision)).toEqual({ success: true });
    expect(state.docs.get('posts/post')?.data).toMatchObject({ status: 'published', moderatedBy: 'admin', moderationReason: decision.reason });
    expect(state.writes.filter(row => row.path.startsWith('auditLogs/'))).toHaveLength(1);
    expect(state.writes.find(row => row.path.startsWith('auditLogs/'))?.data).toMatchObject({ action: 'posts.approve', targetId: 'post', actorUid: 'admin', metadata: { from: 'pending_review', to: 'published', reason: decision.reason } });
  });
  it('rejects stale decisions without changing the post and cannot restore a removed post', async () => {
    seed(); put('posts/post', state.docs.get('posts/post')!.data, 2); expect(await moderatePost(decision)).toHaveProperty('error');
    seed({ status: 'removed' }); expect(await moderatePost(decision)).toHaveProperty('error'); expect(state.writes).toEqual([]);
  });
  it('rolls back moderation if audit creation fails', async () => {
    seed(); state.failAudit = true; expect(await moderatePost(decision)).toHaveProperty('error');
    expect(state.docs.get('posts/post')?.data.status).toBe('pending_review'); expect(state.writes).toEqual([]);
  });
  it.each([{ suspended: true }, { deleting: true }, { deletedAccount: true }])('cannot approve with restricted publisher profile %j', async profile => {
    seed(); put('clipProfiles/creator', profile); expect(await moderatePost(decision)).toHaveProperty('error'); expect(state.writes).toEqual([]);
  });
  it.each([{ status: 'suspended' }, { status: 'deleted' }, { status: 'disabled' }, { status: 'banned' }, { disabled: true }])('cannot approve an inactive account %j', async user => {
    seed(); put('users/creator', user); expect(await moderatePost(decision)).toHaveProperty('error'); expect(state.writes).toEqual([]);
  });
  it('cannot approve a deleted account or empty/malformed post', async () => {
    seed(); state.docs.delete('users/creator'); expect(await moderatePost(decision)).toHaveProperty('error');
    seed({ body: ' ', imagePath: null }); expect(await moderatePost(decision)).toHaveProperty('error');
    seed({ body: 'Text', imagePath: 'https://external.invalid/a.jpg' }); expect(await moderatePost(decision)).toHaveProperty('error');
    expect(state.writes).toEqual([]);
  });
  it('can approve a text-only post and remove a post by a now-suspended creator', async () => {
    seed({ imagePath: null }); expect(await moderatePost(decision)).toEqual({ success: true });
    put('clipProfiles/creator', { suspended: true }); expect(await moderatePost({ ...decision, version: '2:0', action: 'remove' })).toEqual({ success: true });
    expect(state.docs.get('posts/post')?.data.status).toBe('removed');
  });
  it('requires a reason and guards against conflicting decisions from a second moderator', async () => {
    seed(); expect(await moderatePost({ ...decision, reason: ' ' })).toHaveProperty('error');
    expect(await moderatePost(decision)).toEqual({ success: true }); state.session.user.uid = 'second-admin';
    expect(await moderatePost({ ...decision, action: 'reject' })).toHaveProperty('error'); expect(state.docs.get('posts/post')?.data.status).toBe('published');
  });
});
describe('private post image leases', () => {
  it('only signs an exact owner/post/hash JPEG and never an arbitrary URL or traversal', async () => {
    const bad = ['https://external.invalid/x.jpg', `postMedia/other/post/${'a'.repeat(64)}.jpg`, `postMedia/creator/other/${'a'.repeat(64)}.jpg`, `postMedia/creator/post/../${'a'.repeat(64)}.jpg`, 'postMedia/creator/post/a.jpg', imagePath + '/other', imagePath.replace('.jpg', '.png')];
    for (const path of bad) { expect(validPostImagePath('creator', 'post', path)).toBe(false); seed({ imagePath: path }); expect(await getAdminPostImage('post')).toHaveProperty('error'); }
    expect(state.signed).toEqual([]);
    seed(); const start = Date.now(), result = await getAdminPostImage('post'); expect(result.url).toBe('https://signed.invalid/private');
    expect(result.expiresAtMs! - start).toBeGreaterThanOrEqual(120_000); expect(result.expiresAtMs! - Date.now()).toBeLessThanOrEqual(120_000);
    expect(state.signed[0]).toMatchObject({ path: imagePath, options: { action: 'read', version: 'v4', responseType: 'image/jpeg' } });
    expect(state.writes[0].data.action).toBe('posts.previewed');
  });
  it('does not issue preview leases for removed posts or return a URL if the audit fails', async () => {
    seed({ status: 'removed' }); expect(await getAdminPostImage('post')).toHaveProperty('error'); expect(state.signed).toHaveLength(0);
    seed(); state.failAudit = true; const result = await getAdminPostImage('post'); expect(result).toHaveProperty('error'); expect(result).not.toHaveProperty('url');
  });
});
describe('post report resolution and pagination', () => {
  it('resolves or dismisses only current open reports and audits the decision atomically', async () => {
    for (const resolution of ['resolved', 'dismissed'] as const) {
      put('postReports/report', { postId: 'post', status: 'open' }); expect(await resolvePostReport({ ...reportDecision, decision: resolution })).toEqual({ success: true });
      expect(state.docs.get('postReports/report')?.data).toMatchObject({ status: resolution, resolvedBy: 'admin', resolution: reportDecision.reason });
      expect(await resolvePostReport({ ...reportDecision, decision: resolution })).toHaveProperty('error');
    }
    expect(state.writes.filter(row => row.path.startsWith('auditLogs/'))).toHaveLength(2);
  });
  it('does not resolve stale/malformed targets or commit if its audit fails', async () => {
    put('postReports/report', { postId: 'post', status: 'open' }, 2); expect(await resolvePostReport(reportDecision)).toHaveProperty('error');
    put('postReports/report', { postId: '../private', status: 'open' }); expect(await resolvePostReport(reportDecision)).toHaveProperty('error');
    put('postReports/report', { postId: 'post', status: 'open' }); state.failAudit = true; expect(await resolvePostReport(reportDecision)).toHaveProperty('error');
    expect(state.docs.get('postReports/report')?.data.status).toBe('open'); expect(state.writes).toEqual([]);
  });
  it('pages posts with a 24-row boundary, validates anchors, and never exposes storage paths', async () => {
    for (let i = 0; i < 26; i++) put(`posts/post-${String(i).padStart(2, '0')}`, { ownerUid: 'creator', body: 'Post', status: 'pending_review', imagePath, createdAt: { toMillis: () => i } });
    const first = await listAdminPosts('pending_review'); expect(first.items).toHaveLength(24); expect(first.nextCursor).toBe('post-02');
    const last = await listAdminPosts('pending_review', first.nextCursor!); expect(last.items).toHaveLength(2); expect(last.nextCursor).toBeNull(); expect(first.items[0]).not.toHaveProperty('imagePath');
    put('posts/changed', { status: 'removed' }); await expect(listAdminPosts('pending_review', 'changed')).rejects.toThrow('changed');
    await expect(listAdminPosts('other')).rejects.toThrow('Invalid post status'); await expect(listAdminPosts('published', '../post')).rejects.toThrow('Invalid page cursor');
  });
  it('filters open reports and refuses resolved or missing report cursors', async () => {
    put('postReports/report', { postId: 'post', status: 'open', reason: 'spam' }); put('postReports/closed', { postId: 'post', status: 'resolved' });
    expect((await listOpenPostReports()).items.map(row => row.id)).toEqual(['report']);
    await expect(listOpenPostReports('closed')).rejects.toThrow('reports changed'); await expect(listOpenPostReports('missing')).rejects.toThrow('reports changed');
  });
});
