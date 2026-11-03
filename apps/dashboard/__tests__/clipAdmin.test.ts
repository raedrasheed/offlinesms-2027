import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  session: { state: 'unauthenticated' } as any,
  docs: new Map<string, { data: Record<string, any>; version: number }>(),
  writes: [] as Array<{ path: string; data: Record<string, any> }>, reads: 0, serial: 0,
  failAudit: false,
  signed: [] as Array<{ path: string; options: any }>,
}));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => ({ value: 'verified-cookie' }) }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/session', () => ({ verifySession: async () => state.session }));
vi.mock('firebase-admin/storage', () => ({ getStorage: () => ({ bucket: () => ({ file: (path: string) => ({
  getSignedUrl: async (options: any) => { state.signed.push({ path, options }); return ['https://signed.invalid/private']; },
}) }) }) }));
vi.mock('../lib/firebase-admin', () => {
  const snapshot = (ref: any) => {
    state.reads++;
    const row = state.docs.get(ref.path);
    return { exists: !!row, ref, id: ref.id, data: () => row?.data,
      get: (field: string) => row?.data[field], updateTime: row ? { seconds: row.version, nanoseconds: 0 } : undefined };
  };
  const doc = (path: string): any => ({ path, id: path.split('/').pop(),
    collection: (name: string) => collection(`${path}/${name}`), get: async () => snapshot(doc(path)) });
  const collection = (path: string): any => ({
    doc: (id?: string) => doc(`${path}/${id ?? `auto-${++state.serial}`}`),
    add: async (data: any) => { state.writes.push({ path: `${path}/auto-${++state.serial}`, data }); },
  });
  return { adminDb: {
    collection, doc,
    getAll: async (...refs: any[]) => refs.map(snapshot),
    runTransaction: async (callback: any) => {
      const pending: any[] = [];
      const tx = {
        get: async (ref: any) => { if (pending.length) throw new Error('read-after-write'); return snapshot(ref); },
        getAll: async (...refs: any[]) => { if (pending.length) throw new Error('read-after-write'); return refs.map(snapshot); },
        set: (ref: any, data: any, options: any) => pending.push({ path: ref.path, data, merge: options?.merge }),
        update: (ref: any, data: any) => pending.push({ path: ref.path, data, merge: true }),
        create: (ref: any, data: any) => {
          if (state.failAudit && ref.path.startsWith('auditLogs/')) throw new Error('Audit unavailable');
          pending.push({ path: ref.path, data });
        },
      };
      await callback(tx);
      for (const write of pending) {
        const old = state.docs.get(write.path);
        state.docs.set(write.path, { data: { ...(write.merge ? old?.data : {}), ...write.data }, version: (old?.version ?? 0) + 1 });
        state.writes.push(write);
      }
    },
  } };
});

import { getAdminClipPreview, moderateClip, resolveClipReport, saveClipSettings, setClipPublisherSuspended } from '../lib/clipAdminActions';
import { getAdminClip, getClipAdminSettings, getClipAdminStats, listAdminClipReports, listAdminClips } from '../lib/clipAdminData';
import { CLIP_CONFIG_DEFAULTS, hasPlatformClipClaims, parseClipAdminConfig, readClipAdminConfig, validateClipMediaPath } from '../lib/clipAdminPolicy';
import { canDo } from '../lib/adminPermissions';

function put(path: string, data: Record<string, any>, version = 1) { state.docs.set(path, { data, version }); }
function configForm() {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...CLIP_CONFIG_DEFAULTS, supportEmail: 'support@example.com', version: '' })) form.set(key, String(value));
  return form;
}
const decision = { clipId: 'video', action: 'approve' as const, reason: 'Reviewed and suitable', version: '1:0' };
const reportDecision = { reportId: 'report', version: '1:0', decision: 'resolved' as const, action: 'remove_comment' as const, reason: 'Abusive comment removed' };
function seedClip(extra: Record<string, any> = {}) {
  put('clips/video', { ownerUid: 'creator', status: 'pending_review', standardPath: 'clipMedia/creator/video/standard.mp4', commentCount: 2, ...extra });
  put('users/creator', { status: 'active', displayName: 'Creator' });
}

beforeEach(() => {
  state.session = { state: 'authorized', role: 'super_admin', user: { uid: 'admin', email: 'admin@example.com', claims: { role: 'super_admin' } } };
  state.docs.clear(); state.writes = []; state.reads = 0; state.serial = 0; state.failAudit = false; state.signed = [];
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'test-private-bucket';
});

describe('Clips platform access', () => {
  it('grants capabilities only to permanent platform roles', () => {
    for (const role of ['organization_admin', 'support_agent', 'finance_admin', 'auditor', 'bootstrap_admin'] as const) {
      expect(canDo(role, 'view:clips')).toBe(false); expect(canDo(role, 'manage:clips')).toBe(false);
    }
    expect(canDo('super_admin', 'manage:clips')).toBe(true);
    expect(canDo('legacy_admin', 'manage:clips')).toBe(true);
  });
  it('does not elevate conflicting legacy booleans or role arrays', () => {
    expect(hasPlatformClipClaims({ admin: true })).toBe(true);
    for (const claims of [{ admin: true, role: 'organization_admin' }, { admin: true, organizationId: 'org' }, { admin: true, roles: ['support_agent'] }, { permissions: { canAccessAdmin: true } }]) expect(hasPlatformClipClaims(claims)).toBe(false);
  });
  it('rejects every server entry point before reading data or signing for unauthorized sessions', async () => {
    const sessions = [
      { state: 'unauthenticated' },
      ...['organization_admin', 'support_agent', 'finance_admin', 'auditor', 'bootstrap_admin'].map(role => ({ state: 'authorized', role, user: { uid: 'restricted', claims: { role } } })),
      { state: 'authorized', role: 'legacy_admin', user: { uid: 'org', claims: { admin: true, role: 'organization_admin' } } },
    ];
    for (const session of sessions) {
      state.session = session;
      for (const read of [() => getAdminClip('video'), () => getClipAdminSettings(), () => getClipAdminStats(), () => listAdminClips({}), () => listAdminClipReports({})]) await expect(read()).rejects.toThrow('Platform administrator');
      for (const result of [await moderateClip(decision), await getAdminClipPreview('video'), await saveClipSettings(null, configForm()), await resolveClipReport(reportDecision), await setClipPublisherSuspended({ uid: 'creator', suspended: true, version: '', reason: 'Spam violation' })]) expect(result).toHaveProperty('error');
    }
    expect(state.reads).toBe(0); expect(state.writes).toEqual([]); expect(state.signed).toEqual([]);
  });
});

describe('Clips settings and private media', () => {
  it('starts disabled with review enabled and inherits the configured support contact', () => {
    expect(readClipAdminConfig({}, 'help@example.com')).toEqual({ ...CLIP_CONFIG_DEFAULTS, supportEmail: 'help@example.com' });
    expect(readClipAdminConfig({ enabled: 'true', maxUploadMB: 999 })).toMatchObject({ enabled: false, maxUploadMB: 200 });
  });
  it('accepts only configuration fields, bounds limits and requires a contact when enabling', async () => {
    const form = configForm(); form.set('admin', 'true'); form.set('status', 'published');
    expect(parseClipAdminConfig(form)).not.toHaveProperty('admin');
    expect(await saveClipSettings(null, form)).toEqual({ success: true });
    expect(state.docs.get('systemSettings/clips')?.data).not.toHaveProperty('status');
    expect(state.writes.filter(w => w.path.startsWith('auditLogs/'))).toHaveLength(1);
    for (const [key, value] of [['maxUploadMB', '201'], ['maxDailyUploads', '0'], ['maxDurationSeconds', '0'], ['enabled', 'yes'], ['termsVersion', 'x'.repeat(51)]]) {
      const bad = configForm(); bad.set(key, value); expect(() => parseClipAdminConfig(bad)).toThrow();
    }
    const enabled = configForm(); enabled.set('enabled', 'true'); enabled.set('supportEmail', ''); expect(() => parseClipAdminConfig(enabled)).toThrow('support email');
  });
  it('rejects stale settings and rolls back if the audit cannot be written', async () => {
    put('systemSettings/clips', { enabled: true }, 2);
    expect(await saveClipSettings(null, configForm())).toHaveProperty('error'); expect(state.writes).toHaveLength(0);
    const form = configForm(); form.set('version', '2:0'); state.failAudit = true;
    expect(await saveClipSettings(null, form)).toHaveProperty('error');
    expect(state.docs.get('systemSettings/clips')?.data.enabled).toBe(true); expect(state.writes).toHaveLength(0);
  });
  it('never signs a supplied URL, source upload, another owner or cover as a video', async () => {
    for (const path of ['https://evil.invalid/a.mp4', 'clipUploads/creator/video/source', 'clipMedia/other/video/standard.mp4', 'clipMedia/creator/video/cover.jpg', 'clipMedia/creator/video/../standard.mp4']) {
      seedClip({ standardPath: path }); expect(await getAdminClipPreview('video')).toHaveProperty('error');
    }
    expect(state.signed).toHaveLength(0);
    expect(validateClipMediaPath('creator', 'video', 'clipMedia/creator/video/dataSaver.mp4')).toBe(true);
  });
  it('issues an audited 120-second read lease for a pending review copy even before launch', async () => {
    seedClip(); put('systemSettings/clips', { enabled: false });
    const start = Date.now(); const result = await getAdminClipPreview('video');
    expect(result.url).toBe('https://signed.invalid/private');
    expect(state.signed[0]).toMatchObject({ path: 'clipMedia/creator/video/standard.mp4', options: { action: 'read', version: 'v4' } });
    expect(result.expiresAtMs! - start).toBeGreaterThanOrEqual(120_000);
    expect(result.expiresAtMs! - Date.now()).toBeLessThanOrEqual(120_000);
    expect(state.writes[0].data.action).toBe('clips.previewed');
  });
});

describe('Clips moderation transactions', () => {
  it('approves once, preserves first publication time and audits a retried request once', async () => {
    seedClip();
    expect(await moderateClip(decision)).toEqual({ success: true });
    const publication = state.docs.get('clips/video')?.data.publishedAt;
    expect(await moderateClip(decision)).toEqual({ success: true });
    expect(state.docs.get('clips/video')?.data).toMatchObject({ status: 'published', moderatedBy: 'admin', publishedAt: publication });
    expect(state.writes.filter(w => w.path.startsWith('auditLogs/'))).toHaveLength(1);
  });
  it('rejects stale or incompatible moderation and does not approve an unprocessed or mislabeled file', async () => {
    seedClip(); put('clips/video', state.docs.get('clips/video')!.data, 2);
    expect(await moderateClip(decision)).toHaveProperty('error');
    for (const standardPath of [undefined, 'clipMedia/creator/video/cover.jpg', 'clipMedia/other/video/standard.mp4']) {
      seedClip({ standardPath }); expect(await moderateClip(decision)).toHaveProperty('error');
    }
    seedClip({ status: 'processing' }); expect(await moderateClip(decision)).toHaveProperty('error');
    expect(state.writes).toHaveLength(0);
  });
  it('does not commit the moderation decision if its audit fails', async () => {
    seedClip(); state.failAudit = true;
    expect(await moderateClip(decision)).toHaveProperty('error');
    expect(state.docs.get('clips/video')?.data.status).toBe('pending_review'); expect(state.writes).toHaveLength(0);
  });
  it('a second moderator cannot overwrite a decision using an older version', async () => {
    seedClip(); expect(await moderateClip(decision)).toEqual({ success: true });
    state.session.user.uid = 'second-admin';
    expect(await moderateClip({ ...decision, action: 'remove', reason: 'Different decision' })).toHaveProperty('error');
    expect(state.docs.get('clips/video')?.data.status).toBe('published');
  });
  it('restricts only the Clips profile and refuses a stale restoration', async () => {
    seedClip();
    expect(await setClipPublisherSuspended({ uid: 'creator', suspended: true, reason: 'Repeated abuse', version: '' })).toEqual({ success: true });
    expect(state.docs.get('users/creator')?.data.status).toBe('active');
    expect(state.docs.get('clipProfiles/creator')?.data.suspended).toBe(true);
    expect(await setClipPublisherSuspended({ uid: 'creator', suspended: false, reason: 'Appeal accepted', version: '' })).toHaveProperty('error');
    expect(state.docs.get('clipProfiles/creator')?.data.suspended).toBe(true);
  });
  it('cannot restore an account erasure tombstone even with the current version', async () => {
    seedClip(); put('clipProfiles/creator', { suspended: true, deleting: true, deletedAccount: true });
    expect(await setClipPublisherSuspended({ uid: 'creator', suspended: false, reason: 'Appeal accepted', version: '1:0' })).toHaveProperty('error');
    expect(state.writes).toHaveLength(0);
  });
  it('resolves duplicate comment reports without double-decrementing counters', async () => {
    seedClip({ status: 'published' });
    put('clips/video/comments/reply', { text: 'Abuse', authorUid: 'commenter', parentId: 'parent', deleted: false });
    put('clips/video/comments/parent', { text: 'Parent', replyCount: 1 });
    for (const id of ['report', 'duplicate']) put(`clipReports/${id}`, { clipId: 'video', commentId: 'reply', status: 'open' });
    expect(await resolveClipReport(reportDecision)).toEqual({ success: true });
    expect(await resolveClipReport(reportDecision)).toEqual({ success: true });
    expect(await resolveClipReport({ ...reportDecision, reportId: 'duplicate' })).toEqual({ success: true });
    expect(state.docs.get('clips/video/comments/reply')?.data).toMatchObject({ text: '', deleted: true });
    expect(state.docs.get('clips/video/comments/parent')?.data.replyCount).toBe(0);
    expect(state.docs.get('clips/video')?.data.commentCount).toBe(1);
    expect(state.writes.filter(w => w.path.startsWith('auditLogs/'))).toHaveLength(2);
  });
  it('does not allow dismissal with a destructive action, stale resolution or malformed reason', async () => {
    seedClip(); put('clipReports/report', { clipId: 'video', status: 'open' }, 2);
    expect(await resolveClipReport({ ...reportDecision, decision: 'dismissed' })).toHaveProperty('error');
    expect(await resolveClipReport({ ...reportDecision, action: 'none' })).toHaveProperty('error');
    expect(await moderateClip({ ...decision, reason: ' ' })).toHaveProperty('error');
    expect(state.writes).toHaveLength(0);
  });
});
