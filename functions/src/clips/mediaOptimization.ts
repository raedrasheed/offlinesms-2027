import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FieldPath, FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { CLIP_ENCODING_VERSION, probeClipVideo, renderClipVideo } from './mediaTools';
import { clipId, millis } from './model';
import { clipOptimizedOutputPath, clipOutputPath } from './media';

const READY = ['published', 'pending_review', 'rejected'];
const LEASE_MS = 12 * 60_000;
const MAX_ATTEMPTS = 3;

/** Upload immutable complete MP4s, then switch the server playback pointer in
 * one transaction. Existing streams keep their original objects and URLs. */
export async function optimizeClipMedia(id: string): Promise<boolean> {
  clipId(id);
  const db = getFirestore(), ref = db.doc(`clips/${id}`), lease = randomUUID();
  const bucket = getStorage().bucket();
  // A killed worker may have left a staged folder. Clean it after its lease,
  // including when its last render attempt exhausted the retry budget.
  const previous = await ref.get();
  if (previous.get('optimizationPendingToken') && millis(previous.get('optimizationLeaseUntil')) <= Date.now()) {
    const oldToken = previous.get('optimizationPendingToken');
    const oldPath = clipOptimizedOutputPath(clipId(previous.get('ownerUid'), 'ownerUid'), id, oldToken, 'standard');
    await bucket.deleteFiles({ prefix: oldPath.slice(0, oldPath.lastIndexOf('/') + 1), force: true });
    await db.runTransaction(async tx => {
      const fresh = await tx.get(ref);
      if (fresh.get('optimizationPendingToken') === oldToken && millis(fresh.get('optimizationLeaseUntil')) <= Date.now())
        tx.update(ref, { optimizationPendingToken: null });
    });
  }
  const acquired = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!READY.includes(snap.get('status')) || Number(snap.get('encodingVersion') ?? 0) >= CLIP_ENCODING_VERSION
        || snap.get('optimizationFailedVersion') === CLIP_ENCODING_VERSION
        || snap.get('optimizationPendingToken') || millis(snap.get('optimizationLeaseUntil')) > Date.now()) return null;
    const ownerUid = clipId(snap.get('ownerUid'), 'ownerUid');
    const paths = ['standard.mp4', 'dataSaver.mp4', 'cover.jpg'].map(file =>
      clipOutputPath(ownerUid, id, file as 'standard.mp4' | 'dataSaver.mp4' | 'cover.jpg'));
    if (snap.get('standardPath') !== paths[0] || snap.get('dataSaverPath') !== paths[1] || snap.get('coverPath') !== paths[2]) return null;
    const attempts = (snap.get('optimizationTargetVersion') === CLIP_ENCODING_VERSION
      ? Number(snap.get('optimizationAttempts') ?? 0) : 0) + 1;
    if (attempts > MAX_ATTEMPTS) return null;
    tx.update(ref, { optimizationLeaseToken: lease, optimizationPendingToken: lease,
      optimizationLeaseUntil: Timestamp.fromMillis(Date.now() + LEASE_MS),
      optimizationAttempts: attempts, optimizationTargetVersion: CLIP_ENCODING_VERSION });
    return { paths, ownerUid, attempts, renderVersion: snap.get('renderVersion') };
  });
  if (!acquired) return false;
  let directory: string | null = null, committed = false;
  const derived: { standard: string | null; dataSaver: string | null } = { standard: null, dataSaver: null };
  const prefix = clipOptimizedOutputPath(acquired.ownerUid, id, lease, 'standard').replace(/standard\.mp4$/, '');
  try {
    const metadata = await Promise.all(acquired.paths.map(async path => (await bucket.file(path).getMetadata())[0]));
    if (metadata.some(meta => !meta.generation || !Number.isSafeInteger(Number(meta.size)) || Number(meta.size) <= 0)
        || metadata[0].contentType !== 'video/mp4' || metadata[1].contentType !== 'video/mp4'
        || Number(metadata[0].size) > 200 * 1024 * 1024) throw new Error('clip-optimization-source-invalid');
    directory = await mkdtemp(join(tmpdir(), 'offlinesms-clip-optimize-'));
    const source = join(directory, 'source.mp4');
    await bucket.file(acquired.paths[0], { generation: String(metadata[0].generation) })
      .download({ destination: source, validation: 'crc32c' });
    if ((await stat(source)).size !== Number(metadata[0].size)) throw new Error('clip-optimization-source-invalid');
    const probe = await probeClipVideo(source);
    if (probe.durationMs > 180_100) throw new Error('clip-optimization-source-invalid');
    // Edits are already baked into standard. Keep the user's selected cover.
    const output = await renderClipVideo(source, directory, {
      trimStartMs: 0, trimEndMs: probe.durationMs, coverTimeMs: 0, overlayText: '', mute: false,
    });
    let addedBytes = 0;
    const renditions = [
      { quality: 'standard' as const, local: output.standard },
      { quality: 'dataSaver' as const, local: output.dataSaver },
    ];
    for (let index = 0; index < renditions.length; index++) {
      const { quality, local } = renditions[index], size = (await stat(local)).size;
      if (size >= Number(metadata[index].size)) continue;
      const fresh = await ref.get();
      if (!READY.includes(fresh.get('status')) || fresh.get('renderVersion') !== acquired.renderVersion
          || fresh.get('optimizationLeaseToken') !== lease || millis(fresh.get('optimizationLeaseUntil')) <= Date.now()) return false;
      const path = clipOptimizedOutputPath(acquired.ownerUid, id, lease, quality);
      const [uploaded] = await bucket.upload(local, {
        destination: path, resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType: 'video/mp4', cacheControl: 'private, max-age=60',
          metadata: { clipId: id, ownerUid: acquired.ownerUid, encodingVersion: String(CLIP_ENCODING_VERSION) } },
      });
      if (!uploaded.metadata.generation) throw new Error('clip-optimization-upload-invalid');
      await bucket.file(path, { generation: String(uploaded.metadata.generation) })
        .setMetadata({ metadata: { firebaseStorageDownloadTokens: null } });
      derived[quality] = path;
      addedBytes += size;
    }
    const originalBytes = metadata.reduce((sum, meta) => sum + Number(meta.size), 0);
    committed = await db.runTransaction(async tx => {
      const fresh = await tx.get(ref);
      if (!READY.includes(fresh.get('status')) || fresh.get('renderVersion') !== acquired.renderVersion
          || fresh.get('optimizationLeaseToken') !== lease || millis(fresh.get('optimizationLeaseUntil')) <= Date.now()) return false;
      const processedBytes = originalBytes + addedBytes;
      tx.update(ref, { encodingVersion: CLIP_ENCODING_VERSION,
        optimizedPlayback: { version: CLIP_ENCODING_VERSION, token: lease, ...derived },
        processedBytes, totalStorageBytes: processedBytes + Number(fresh.get('sourceSizeBytes') ?? 0),
        optimizedAt: FieldValue.serverTimestamp(), optimizationError: null,
        optimizationLeaseToken: null, optimizationLeaseUntil: null, optimizationPendingToken: null });
      return true;
    });
    return committed;
  } catch (error) {
    await db.runTransaction(async tx => {
      const fresh = await tx.get(ref);
      if (fresh.get('optimizationLeaseToken') !== lease) return;
      tx.update(ref, { optimizationError: 'processing-failed', optimizationLeaseToken: null, optimizationLeaseUntil: null,
        ...(acquired.attempts >= MAX_ATTEMPTS ? { optimizationFailedVersion: CLIP_ENCODING_VERSION } : {}) });
    });
    throw error;
  } finally {
    try {
      if (!committed) {
        // A lost transaction response must not erase a durably published
        // rendition. If this read fails, retain the staging files for retry.
        const final = await ref.get();
        committed = READY.includes(final.get('status')) && final.get('optimizedPlayback.token') === lease;
      }
      if (!committed) {
        // Keep the pending token durable if cleanup fails, so the next scan
        // removes the staging folder before another render is acquired.
        await bucket.deleteFiles({ prefix, force: true });
        await db.runTransaction(async tx => {
          const fresh = await tx.get(ref);
          if (fresh.exists && fresh.get('optimizationPendingToken') === lease)
            tx.update(ref, { optimizationPendingToken: null, optimizationLeaseToken: null, optimizationLeaseUntil: null });
        });
      }
    } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  }
}

/** One legacy clip per run bounds CPU and memory. A document-ID cursor includes
 * legacy documents with no encodingVersion and needs no additional index. */
export const optimizeExistingClipMedia = onSchedule({
  schedule: 'every 5 minutes', region: 'us-central1', memory: '1GiB',
  timeoutSeconds: 540, maxInstances: 1, concurrency: 1,
}, async () => {
  const db = getFirestore(), state = db.doc('systemState/clipMediaOptimization');
  const cursor = (await state.get()).get('lastId');
  let query = db.collection('clips').orderBy(FieldPath.documentId()).limit(50);
  if (typeof cursor === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(cursor)) query = query.startAfter(cursor);
  const rows = await query.get();
  for (const row of rows.docs) {
    if (!row.get('optimizationPendingToken') && (!READY.includes(row.get('status'))
        || Number(row.get('encodingVersion') ?? 0) >= CLIP_ENCODING_VERSION
        || row.get('optimizationFailedVersion') === CLIP_ENCODING_VERSION)) continue;
    try { await optimizeClipMedia(row.id); }
    catch (error) { console.warn('Clip optimization will retry', { clipId: row.id, code: (error as any)?.code ?? 'processing-failed' }); }
    await state.set({ lastId: row.id, updatedAt: FieldValue.serverTimestamp() });
    return;
  }
  await state.set({ lastId: rows.size === 50 ? rows.docs[rows.size - 1].id : null, updatedAt: FieldValue.serverTimestamp() });
});
