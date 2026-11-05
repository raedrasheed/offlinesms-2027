import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { signatureMatches } from './attachmentIntegrity';
import { renderChatVideoFirstFrame } from './videoThumbnailTools';
import { activeSocialAccount } from '../social/access';
import { CHAT_THUMBNAIL_LEASE_MS, CHAT_THUMBNAIL_MAX_ATTEMPTS, CHAT_THUMBNAIL_VERSION,
  chatVideoSource, chatThumbnailResult, shouldGenerateChatThumbnail, validChatIdentifier,
  type ChatVideoSource, type ChatThumbnailResult } from './videoThumbnailPolicy';

async function assertViewer(tx: Transaction, db: Firestore, conversationId: string, uid: string) {
  const [conversation, user, profile] = await tx.getAll(db.doc(`conversations/${conversationId}`), db.doc(`users/${uid}`), db.doc(`clipProfiles/${uid}`));
  const c = conversation.data(), roster = c?.participantUids ?? c?.memberIds ?? [];
  if (!c || !Array.isArray(roster) || !roster.includes(uid) || c.status === 'disabled')
    throw new HttpsError('permission-denied', 'not-a-participant');
  if (!activeSocialAccount(user.data(), profile.data()))
    throw new HttpsError('permission-denied', 'account-unavailable');
  if (c.type === 'group') {
    const member = await tx.get(db.doc(`conversations/${conversationId}/members/${uid}`));
    if (!member.exists || (member.get('status') ?? 'active') !== 'active')
      throw new HttpsError('permission-denied', 'not-an-active-member');
  } else {
    const peer = roster.find((id: unknown) => typeof id === 'string' && id !== uid);
    if (peer) {
      const blocks = await tx.getAll(db.doc(`users/${uid}/blockedUsers/${peer}`), db.doc(`users/${peer}/blockedUsers/${uid}`));
      if (blocks.some(block => block.exists)) throw new HttpsError('permission-denied', 'conversation-blocked');
    }
  }
}

/** Old videos are queued on demand by a currently authorized viewer. New
 * uploads/forwards are handled directly by the Firestore trigger below. */
export const ensureChatVideoThumbnail = onCall({ region: 'us-central1', maxInstances: 5 }, async (request): Promise<ChatThumbnailResult> => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const { conversationId, messageId } = request.data ?? {};
  if (!validChatIdentifier(conversationId) || !validChatIdentifier(messageId)) throw new HttpsError('invalid-argument', 'message-identifiers-required');
  const db = getFirestore(), ref = db.doc(`conversations/${conversationId}/messages/${messageId}`);
  return db.runTransaction(async tx => {
    await assertViewer(tx, db, conversationId, uid);
    const message = await tx.get(ref), data = message.data();
    const source = chatVideoSource(conversationId, messageId, data);
    if (!source) throw new HttpsError('not-found', 'video-unavailable');
    const result = chatThumbnailResult(data!, source);
    if (result.state !== 'pending') return result;
    // A durable request/event or current lease already owns this source.
    if (data!.media.thumbnailSourceKey === source.key && (data!.media.thumbnailRequestId
        || data!.media.thumbnailState === 'processing' || Number(data!.media.thumbnailAttempts) > 0)) return result;
    const rateRef = db.doc(`chatThumbnailRateLimits/${uid}`), rate = await tx.get(rateRef), now = Date.now();
    const inWindow = now - Number(rate.get('windowStartMs') ?? 0) < 60_000;
    const count = inWindow ? Number(rate.get('count') ?? 0) : 0;
    if (count >= 30) throw new HttpsError('resource-exhausted', 'thumbnail-rate-limited');
    tx.set(rateRef, { count: count + 1, windowStartMs: inWindow ? rate.get('windowStartMs') : now });
    tx.update(ref, { 'media.thumbnailSourceKey': source.key, 'media.thumbnailState': 'pending',
      'media.thumbnailRequestId': randomUUID(), 'media.thumbnailAttempts': 0,
      'media.thumbnailLeaseId': null, 'media.thumbnailLeaseUntilMs': 0 });
    return { state: 'pending' as const };
  });
});

type Render = typeof renderChatVideoFirstFrame;
/** Dependency injection keeps race tests on real emulator documents/storage,
 * without substituting any authorization or transaction behavior. */
export async function processChatVideoThumbnail(conversationId: string, messageId: string,
  eventSource?: ChatVideoSource, render: Render = renderChatVideoFirstFrame): Promise<void> {
  if (!validChatIdentifier(conversationId) || !validChatIdentifier(messageId)) return;
  const db = getFirestore(), ref = db.doc(`conversations/${conversationId}/messages/${messageId}`);
  const lease = randomUUID(), bucket = getStorage().bucket();
  const acquired = await db.runTransaction(async tx => {
    const [snap, conversation] = await tx.getAll(ref, db.doc(`conversations/${conversationId}`));
    const message = snap.data(), source = chatVideoSource(conversationId, messageId, message);
    if (!source || !conversation.exists || conversation.get('status') === 'disabled') return null;
    const sameSource = message!.media.thumbnailSourceKey === source.key;
    if (sameSource && chatThumbnailResult(message!, source).state !== 'pending') return null;
    if (sameSource && Number(message!.media.thumbnailLeaseUntilMs) > Date.now()) throw new Error('chat-thumbnail-busy');
    const attempts = sameSource ? Number(message!.media.thumbnailAttempts ?? 0) : 0;
    if (attempts >= CHAT_THUMBNAIL_MAX_ATTEMPTS) {
      tx.update(ref, { 'media.thumbnailState': 'failed', 'media.thumbnailLeaseId': null, 'media.thumbnailLeaseUntilMs': 0 });
      return null;
    }
    tx.update(ref, { 'media.thumbnailSourceKey': source.key, 'media.thumbnailState': 'processing',
      'media.thumbnailAttempts': attempts + 1, 'media.thumbnailLeaseId': lease,
      'media.thumbnailLeaseUntilMs': Date.now() + CHAT_THUMBNAIL_LEASE_MS,
      ...(!sameSource ? { 'media.thumbnailPath': null, 'media.thumbnailURL': null } : {}) });
    return { source, attempts: attempts + 1 };
  });
  if (!acquired) {
    // The original event survives message deletion. Its server-derived source
    // lets a retry clean an output uploaded after a deletion's prefix purge.
    const closed = await ref.get();
    if (eventSource && (!closed.exists || closed.get('deletedForEveryone') || closed.get('retentionDeleting')))
      await bucket.deleteFiles({ prefix: `${eventSource.prefix}video-first-frame-v1-`, force: true });
    return;
  }
  const source = acquired.source;
  let directory: string | null = null, outputPath: string | null = null;
  try {
    const [metadata] = await bucket.file(source.path).getMetadata();
    if (Number(metadata.size) !== source.size || metadata.contentType !== source.mime || !metadata.generation)
      throw new Error('chat-thumbnail-source-invalid');
    const generation = String(metadata.generation), file = bucket.file(source.path, { generation });
    const [header] = await file.download({ start: 0, end: Math.min(source.size - 1, 511) });
    if (!signatureMatches(source.mime, header)) throw new Error('chat-thumbnail-source-invalid');
    directory = await mkdtemp(join(tmpdir(), 'offlinesms-chat-preview-'));
    const local = join(directory, 'source');
    await file.download({ destination: local, validation: 'crc32c' });
    if ((await stat(local)).size !== source.size) throw new Error('chat-thumbnail-source-invalid');
    const output = await render(local, directory);
    const fresh = await ref.get(), freshSource = chatVideoSource(conversationId, messageId, fresh.data());
    if (freshSource?.key !== source.key || fresh.get('media.thumbnailLeaseId') !== lease
        || Number(fresh.get('media.thumbnailLeaseUntilMs')) <= Date.now()) return;
    const [currentObject] = await bucket.file(source.path).getMetadata();
    if (String(currentObject.generation) !== generation) throw new Error('chat-thumbnail-source-invalid');
    // A unique fenced output prevents a stale worker from deleting a newer
    // worker's successful thumbnail during cleanup.
    outputPath = `${source.prefix}video-first-frame-v1-${lease}.jpg`;
    const token = randomUUID();
    await bucket.upload(output, { destination: outputPath, resumable: false,
      metadata: { contentType: 'image/jpeg', cacheControl: 'private, max-age=3600',
        metadata: { firebaseStorageDownloadTokens: token, sourceGeneration: generation } } });
    const thumbnailURL = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(outputPath)}?alt=media&token=${token}`;
    await db.runTransaction(async tx => {
      const [current, conversation] = await tx.getAll(ref, db.doc(`conversations/${conversationId}`));
      const currentSource = chatVideoSource(conversationId, messageId, current.data());
      if (currentSource?.key !== source.key || current.get('media.thumbnailLeaseId') !== lease
          || !conversation.exists || conversation.get('status') === 'disabled') return;
      tx.update(ref, { 'media.thumbnailPath': outputPath, 'media.thumbnailURL': thumbnailURL,
        'media.thumbnailVersion': CHAT_THUMBNAIL_VERSION, 'media.thumbnailState': 'ready',
        'media.thumbnailSourceGeneration': generation, 'media.thumbnailLeaseId': null,
        'media.thumbnailLeaseUntilMs': 0, 'media.thumbnailError': null, updatedAt: FieldValue.serverTimestamp() });
    });
  } catch (error) {
    const invalid = /chat-thumbnail-(source|media|output)-invalid/.test(error instanceof Error ? error.message : '') || (error as any)?.code === 404;
    const terminal = invalid || acquired.attempts >= CHAT_THUMBNAIL_MAX_ATTEMPTS;
    await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (current.get('media.thumbnailLeaseId') !== lease || !chatVideoSource(conversationId, messageId, current.data())) return;
      tx.update(ref, { 'media.thumbnailState': terminal ? 'failed' : 'pending',
        'media.thumbnailLeaseId': null, 'media.thumbnailLeaseUntilMs': 0,
        'media.thumbnailError': invalid ? 'invalid-media' : 'processing-failed' });
    });
    if (!terminal) throw error;
  } finally {
    try {
      if (outputPath) {
        const final = await ref.get();
        if (!chatVideoSource(conversationId, messageId, final.data()) || final.get('media.thumbnailPath') !== outputPath)
          await bucket.file(outputPath).delete({ ignoreNotFound: true });
      }
    } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  }
}

export const onChatVideoThumbnailWrite = onDocumentWritten({ document: 'conversations/{conversationId}/messages/{messageId}',
  region: 'us-central1', memory: '1GiB', timeoutSeconds: 180, concurrency: 1, maxInstances: 3, retry: true }, async event => {
  const before = event.data?.before.data(), after = event.data?.after.data();
  const { conversationId, messageId } = event.params;
  if (!shouldGenerateChatThumbnail(conversationId, messageId, before, after)) return;
  await processChatVideoThumbnail(conversationId, messageId, chatVideoSource(conversationId, messageId, after)!);
});
