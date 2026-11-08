import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStorage } from 'firebase-admin/storage';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { db, req, resetEmulators } from './harness';
import { ensureChatVideoThumbnail, processChatVideoThumbnail } from '../src/chats/videoThumbnails';
import { chatVideoSource } from '../src/chats/videoThumbnailPolicy';

const conversationId = 'thumbnail-test', messageId = 'video-message';
const ref = () => db().doc(`conversations/${conversationId}/messages/${messageId}`);
const bytes = Buffer.alloc(24); bytes.write('ftypisom', 4);
const sourcePath = `chatMedia/${conversationId}/sender/${messageId}/video.mp4`;
const sourceMessage = () => ({ type: 'video', senderUid: 'sender', deletedForEveryone: false,
  media: { uploadStatus: 'uploaded', storagePath: sourcePath, mimeType: 'video/mp4', sizeBytes: bytes.length } });
const payload = { conversationId, messageId };
async function output(local: string, directory: string) {
  expect(await readFile(local)).toEqual(bytes);
  const path = join(directory, 'preview.jpg'); await writeFile(path, Buffer.from([255, 216, 255, 217])); return path;
}
async function source() { await getStorage().bucket().file(sourcePath).save(bytes, { metadata: { contentType: 'video/mp4' } }); }
beforeEach(async () => {
  await resetEmulators();
  await db().doc(`conversations/${conversationId}`).set({ type: 'direct', participantUids: ['sender', 'viewer'], status: 'active' });
  await Promise.all(['sender', 'viewer'].map(uid => db().doc(`users/${uid}`).set({ status: 'active' })));
  await ref().set(sourceMessage());
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (process.env.FIREBASE_STORAGE_EMULATOR_HOST) await getStorage().bucket().deleteFiles({ prefix: `chatMedia/${conversationId}/`, force: true });
});
describe('chat video thumbnail handlers', () => {
  it('queues an older video once and does not reserve another job on repeated requests', async () => {
    expect(await ensureChatVideoThumbnail.run(req('viewer', payload))).toEqual({ state: 'pending' });
    const first = (await ref().get()).get('media.thumbnailRequestId');
    expect(first).toBeTypeOf('string');
    expect(await ensureChatVideoThumbnail.run(req('viewer', payload))).toEqual({ state: 'pending' });
    expect((await ref().get()).get('media.thumbnailRequestId')).toBe(first);
    expect((await db().doc('chatThumbnailRateLimits/viewer').get()).get('count')).toBe(1);
  });
  it('rejects anonymous, outsider, suspended and blocked viewers before enqueueing', async () => {
    await expect(ensureChatVideoThumbnail.run(req(null, payload))).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(ensureChatVideoThumbnail.run(req('outsider', payload))).rejects.toMatchObject({ code: 'permission-denied' });
    await db().doc('users/viewer').update({ status: 'suspended' });
    await expect(ensureChatVideoThumbnail.run(req('viewer', payload))).rejects.toThrow('account-unavailable');
    await db().doc('users/viewer').update({ status: 'active' });
    for (const path of ['users/sender/blockedUsers/viewer', 'users/viewer/blockedUsers/sender']) {
      await db().doc(path).set({});
      await expect(ensureChatVideoThumbnail.run(req('viewer', payload))).rejects.toThrow('conversation-blocked');
      await db().doc(path).delete();
    }
    expect((await ref().get()).get('media.thumbnailRequestId')).toBeUndefined();
  });
  it('requires current active group membership and rejects disabled conversations', async () => {
    await db().doc(`conversations/${conversationId}`).update({ type: 'group' });
    await expect(ensureChatVideoThumbnail.run(req('viewer', payload))).rejects.toThrow('not-an-active-member');
    const member = db().doc(`conversations/${conversationId}/members/viewer`);
    await member.set({ status: 'removed' });
    await expect(ensureChatVideoThumbnail.run(req('viewer', payload))).rejects.toThrow('not-an-active-member');
    await member.update({ status: 'active' });
    await db().doc(`conversations/${conversationId}`).update({ status: 'disabled' });
    await expect(ensureChatVideoThumbnail.run(req('viewer', payload))).rejects.toThrow('not-a-participant');
  });
  it('rejects inactive/deleted accounts and the account-erasure fence while membership still exists', async () => {
    for (const user of [{ status: 'inactive' }, { status: 'deleted' }, { status: 'active', deletedAccount: true }, { status: 'active', disabled: true }]) {
      await db().doc('users/viewer').set(user);
      await expect(ensureChatVideoThumbnail.run(req('viewer', payload))).rejects.toThrow('account-unavailable');
    }
    await db().doc('users/viewer').set({ status: 'active' });
    for (const profile of [{ deleting: true }, { deletedAccount: true }]) {
      await db().doc('clipProfiles/viewer').set(profile);
      await expect(ensureChatVideoThumbnail.run(req('viewer', payload))).rejects.toThrow('account-unavailable');
    }
    expect((await ref().get()).get('media.thumbnailRequestId')).toBeUndefined();
  });
  it('refuses foreign sources and removed messages, and bounds new lazy requests per viewer', async () => {
    await ref().update({ 'media.storagePath': 'chatMedia/another/sender/message/video.mp4' });
    await expect(ensureChatVideoThumbnail.run(req('viewer', payload))).rejects.toMatchObject({ code: 'not-found' });
    await ref().set({ ...sourceMessage(), retentionDeleting: true });
    await expect(ensureChatVideoThumbnail.run(req('viewer', payload))).rejects.toMatchObject({ code: 'not-found' });
    await ref().set(sourceMessage());
    await db().doc('chatThumbnailRateLimits/viewer').set({ windowStartMs: Date.now(), count: 30 });
    await expect(ensureChatVideoThumbnail.run(req('viewer', payload))).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect((await ref().get()).get('media.thumbnailRequestId')).toBeUndefined();
  });
  it.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)('publishes the generated JPEG only after rendering and returns it only to authorized viewers', async () => {
    await source(); const render = vi.fn(output);
    await processChatVideoThumbnail(conversationId, messageId, undefined, render);
    const result = await ensureChatVideoThumbnail.run(req('viewer', payload));
    expect(result.state).toBe('ready'); expect(result.thumbnailPath).toMatch(/video-first-frame-v1-.*\.jpg$/);
    expect(result.thumbnailURL).toContain(encodeURIComponent(result.thumbnailPath!));
    expect((await getStorage().bucket().file(result.thumbnailPath!).getMetadata())[0].contentType).toBe('image/jpeg');
    expect((await ref().get()).get('media.thumbnailSourceGeneration')).toBeTypeOf('string');
    await processChatVideoThumbnail(conversationId, messageId, undefined, render); expect(render).toHaveBeenCalledOnce();
    await expect(ensureChatVideoThumbnail.run(req('outsider', payload))).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)('fences concurrent events and does not let a lazy request reset a running worker', async () => {
    await source(); let entered!: () => void, finish!: () => void;
    const rendering = new Promise<void>(resolve => { entered = resolve; }), release = new Promise<void>(resolve => { finish = resolve; });
    const render = vi.fn(async (local: string, directory: string) => { entered(); await release; return output(local, directory); });
    const first = processChatVideoThumbnail(conversationId, messageId, undefined, render); await rendering;
    const lease = (await ref().get()).get('media.thumbnailLeaseId');
    expect(await ensureChatVideoThumbnail.run(req('viewer', payload))).toEqual({ state: 'pending' });
    expect((await ref().get()).get('media.thumbnailLeaseId')).toBe(lease);
    await expect(processChatVideoThumbnail(conversationId, messageId, undefined, render)).rejects.toThrow('chat-thumbnail-busy');
    finish(); await first;
    expect(render).toHaveBeenCalledOnce(); expect((await ref().get()).get('media.thumbnailAttempts')).toBe(1);
  });
  it.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)('does not decode metadata mismatches or a forged MP4', async () => {
    await source(); const render = vi.fn(output);
    await getStorage().bucket().file(sourcePath).setMetadata({ contentType: 'image/jpeg' });
    await processChatVideoThumbnail(conversationId, messageId, undefined, render);
    expect(render).not.toHaveBeenCalled(); expect((await ref().get()).get('media.thumbnailState')).toBe('failed');
    await ref().set(sourceMessage()); await getStorage().bucket().file(sourcePath).save(Buffer.alloc(bytes.length), { metadata: { contentType: 'video/mp4' } });
    await processChatVideoThumbnail(conversationId, messageId, undefined, render);
    expect(render).not.toHaveBeenCalled(); expect((await ref().get()).get('media.thumbnailState')).toBe('failed');
  });
  it.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)('stops retrying after three transient rendering failures', async () => {
    await source(); const render = vi.fn(async () => { throw new Error('temporary-render-failure'); });
    for (let attempt = 1; attempt < 3; attempt++) await expect(processChatVideoThumbnail(conversationId, messageId, undefined, render)).rejects.toThrow('temporary-render-failure');
    await processChatVideoThumbnail(conversationId, messageId, undefined, render);
    await processChatVideoThumbnail(conversationId, messageId, undefined, render);
    expect(render).toHaveBeenCalledTimes(3); expect((await ref().get()).get('media.thumbnailState')).toBe('failed');
    expect(await ensureChatVideoThumbnail.run(req('viewer', payload))).toEqual({ state: 'failed' });
  });
  it.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)('never publishes after deletion during decoding', async () => {
    await source();
    await processChatVideoThumbnail(conversationId, messageId, undefined, async (local, directory) => {
      await ref().update({ deletedForEveryone: true }); return output(local, directory);
    });
    expect((await ref().get()).get('media.thumbnailURL')).toBeFalsy();
    expect((await getStorage().bucket().getFiles({ prefix: `${sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1)}video-first-frame-` }))[0]).toHaveLength(0);
  });
  it.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)('removes a late JPEG if retention wins after upload and cleans orphan output on event retry', async () => {
    await source();
    const bucket = getStorage().bucket(), prototype = Object.getPrototypeOf(bucket), upload = prototype.upload;
    vi.spyOn(prototype, 'upload').mockImplementation(async function(this: any, ...args: any[]) {
      const result = await upload.apply(this, args); await ref().update({ retentionDeleting: true }); return result;
    });
    const eventSource = chatVideoSource(conversationId, messageId, sourceMessage())!;
    await processChatVideoThumbnail(conversationId, messageId, eventSource, output);
    expect((await ref().get()).get('media.thumbnailURL')).toBeFalsy();
    const prefix = `${eventSource.prefix}video-first-frame-v1-`;
    expect((await bucket.getFiles({ prefix }))[0]).toHaveLength(0);
    await bucket.file(`${prefix}orphan.jpg`).save(Buffer.from([255, 216, 255]));
    await ref().delete();
    await processChatVideoThumbnail(conversationId, messageId, eventSource, output);
    expect((await bucket.getFiles({ prefix }))[0]).toHaveLength(0);
  });
});
