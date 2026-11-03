import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onObjectFinalized, onObjectMetadataUpdated } from 'firebase-functions/v2/storage';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { loadClipsConfig, assertActiveClipUser, assertClipGroupMember, assertClipsEnabled, isClipGroupMember } from './access';
import { clipId, millis, clipsConfig } from './model';
import { clipSourcePath, clipOutputPath } from './media';
import { CLIP_MIME_TYPES, renderClipVideo, validateClipEdits } from './mediaTools';

const LEASE_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;

/** Safe to call from a retried Firestore event: the lease and renderVersion
 * fence concurrent jobs, and publication validates the current owner/status. */
export async function processClipMedia(id: string): Promise<void> {
  clipId(id);
  const db = getFirestore(), ref = db.doc(`clips/${id}`), token = randomUUID();
  const acquired = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get('status') !== 'processing') return null;
    if (millis(snap.get('processingLeaseUntil')) > Date.now()) throw new Error('clip-processing-busy');
    const count = snap.get('processingAttempts') ?? 0;
    if (count >= MAX_ATTEMPTS) {
      tx.update(ref, { status: 'failed', errorCode: 'clip-processing-failed', updatedAt: FieldValue.serverTimestamp() });
      return null;
    }
    tx.update(ref, { processingLeaseToken: token, processingLeaseUntil: Timestamp.fromMillis(Date.now() + LEASE_MS),
      processingAttempts: count + 1, updatedAt: FieldValue.serverTimestamp() });
    return { ...snap.data()!, attempts: count + 1 } as Record<string, any> & { attempts: number };
  });
  if (!acquired) {
    // An earlier attempt may have uploaded after the removal trigger purged,
    // then lost Firestore connectivity before clearing the purge marker. The
    // original event's retry must still remove those late objects.
    const closed = await ref.get();
    if (closed.get('status') === 'removed' && typeof closed.get('ownerUid') === 'string') {
      await purgeClipFiles(id, closed.get('ownerUid'));
      await db.runTransaction(async tx => {
        const fresh = await tx.get(ref);
        if (fresh.get('status') === 'removed') tx.update(ref, { mediaPurgedAt: FieldValue.serverTimestamp(),
          sourceSizeBytes: 0, processedBytes: 0, totalStorageBytes: 0 });
      });
    }
    return;
  }
  const ownerUid = String(acquired.ownerUid), version = acquired.renderVersion;
  let directory: string | null = null;
  let wroteOutputs = false;
  try {
    const config = await loadClipsConfig(db);
    assertClipsEnabled(config);
    await assertActiveClipUser(db, ownerUid);
    if (acquired.audience === 'group') await assertClipGroupMember(db, String(acquired.groupId), ownerUid);
    const edits = validateClipEdits(acquired.edits ?? {}, config.maxDurationSeconds);
    const sourcePath = clipSourcePath(ownerUid, id);
    if (acquired.sourcePath !== sourcePath || typeof acquired.sourceGeneration !== 'string') throw new Error('clip-source-invalid');
    const bucket = getStorage().bucket(), sourceFile = bucket.file(sourcePath, { generation: acquired.sourceGeneration });
    const [metadata] = await sourceFile.getMetadata();
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size <= 0 || size > Math.min(config.maxUploadMB * 1024 * 1024, acquired.maxUploadBytes)
        || !CLIP_MIME_TYPES.includes(String(metadata.contentType))) throw new Error('clip-source-invalid');
    // Source reads are denied by rules; remove Firebase's generated bearer
    // token as defense in depth before processing untrusted media.
    await sourceFile.setMetadata({ metadata: { firebaseStorageDownloadTokens: null } });
    directory = await mkdtemp(join(tmpdir(), 'offlinesms-clip-'));
    const localSource = join(directory, 'source');
    await sourceFile.download({ destination: localSource, validation: 'crc32c' });
    if ((await stat(localSource)).size !== size) throw new Error('clip-source-size-mismatch');
    const output = await renderClipVideo(localSource, directory, edits);
    if (output.durationMs > config.maxDurationSeconds * 1000 + 100) throw new Error('clip-duration-invalid');
    // Renew/fence before publishing derived objects, in case a moderator or
    // account deletion invalidated the job while FFmpeg was running.
    const current = await ref.get();
    if (current.get('status') !== 'processing' || current.get('renderVersion') !== version || current.get('processingLeaseToken') !== token) return;
    const files = [
      { local: output.standard, path: clipOutputPath(ownerUid, id, 'standard.mp4'), type: 'video/mp4' },
      { local: output.dataSaver, path: clipOutputPath(ownerUid, id, 'dataSaver.mp4'), type: 'video/mp4' },
      { local: output.cover, path: clipOutputPath(ownerUid, id, 'cover.jpg'), type: 'image/jpeg' },
    ];
    let processedBytes = 0;
    for (const file of files) {
      wroteOutputs = true;
      processedBytes += (await stat(file.local)).size;
      await bucket.upload(file.local, { destination: file.path, resumable: false,
        metadata: { contentType: file.type, cacheControl: 'private, max-age=60', metadata: { clipId: id, ownerUid, renderVersion: String(version) } } });
      // Never leave Firebase's long-lived token on an output even if a bucket
      // extension automatically adds one during upload.
      await bucket.file(file.path).setMetadata({ metadata: { firebaseStorageDownloadTokens: null } });
    }
    const committed = await db.runTransaction(async tx => {
      const [fresh, settings, owner, profile] = await tx.getAll(ref, db.doc('systemSettings/clips'),
        db.doc(`users/${ownerUid}`), db.doc(`clipProfiles/${ownerUid}`));
      if (fresh.get('status') !== 'processing' || fresh.get('renderVersion') !== version || fresh.get('processingLeaseToken') !== token) return false;
      const latestConfig = clipsConfig(settings.data() ?? {});
      assertClipsEnabled(latestConfig);
      if (!owner.exists || owner.get('status') === 'suspended' || owner.get('disabled') === true
          || profile.get('suspended') === true || profile.get('deleting') === true)
        throw new Error('account-unavailable');
      if (profile.get('termsVersion') !== latestConfig.termsVersion) throw new Error('clips-terms-required');
      if (fresh.get('audience') === 'group' && !(await isClipGroupMember(db, fresh.get('groupId'), ownerUid, tx)))
        throw new Error('clip-group-membership-required');
      if (output.durationMs > latestConfig.maxDurationSeconds * 1000 + 100
          || size > latestConfig.maxUploadMB * 1024 * 1024) throw new Error('clip-media-invalid');
      const review = latestConfig.moderationRequired;
      tx.update(ref, {
        status: review ? 'pending_review' : 'published',
        standardPath: files[0].path, dataSaverPath: files[1].path, coverPath: files[2].path,
        durationMs: output.durationMs, width: output.width, height: output.height, processedBytes,
        totalStorageBytes: processedBytes + size, sourceSizeBytes: size,
        processingLeaseToken: null, processingLeaseUntil: null, errorCode: null,
        processedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        ...(review ? {} : { publishedAt: FieldValue.serverTimestamp() }),
      });
      return true;
    });
    if (!committed) {
      // A removal during upload must not leave valid signed objects behind.
      const invalidated = await ref.get();
      if (!invalidated.exists || invalidated.get('status') === 'removed')
        await Promise.all(files.map(file => bucket.file(file.path).delete({ ignoreNotFound: true })));
      return;
    }
    // Publication is already durable. A transient cleanup failure must not
    // turn a successful render into an attempted re-render; the sweeper also
    // retries source deletion for completed clips whose bytes remain counted.
    await sourceFile.delete({ ignoreNotFound: true }).then(async () => {
      await db.runTransaction(async tx => {
        const fresh = await tx.get(ref);
        if (!fresh.exists || fresh.get('renderVersion') !== version || fresh.get('status') === 'removed') return;
        tx.update(ref, { sourceSizeBytes: 0, totalStorageBytes: processedBytes, sourceDeletedAt: FieldValue.serverTimestamp() });
      });
    }).catch(error => console.warn('Clip source cleanup will retry', { clipId: id, code: (error as any)?.code }));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const invalid = /clip-(source|media|trim|overlay|mute|duration)|account-unavailable|clips-account-suspended|clips-disabled|clips-terms-required|clip-group-membership-required/.test(message)
      || (error as any)?.code === 404;
    const terminal = invalid || acquired.attempts >= MAX_ATTEMPTS;
    await db.runTransaction(async tx => {
      const fresh = await tx.get(ref);
      if (fresh.get('status') !== 'processing' || fresh.get('renderVersion') !== version || fresh.get('processingLeaseToken') !== token) return;
      tx.update(ref, { ...(terminal ? { status: 'failed' } : {}), errorCode: invalid ? 'clip-media-invalid' : 'clip-processing-failed',
        processingLeaseToken: null, processingLeaseUntil: null, updatedAt: FieldValue.serverTimestamp() });
    });
    if (!terminal) throw error;
  } finally {
    try {
      if (wroteOutputs) {
        const finalState = await ref.get();
        if (!finalState.exists || finalState.get('status') === 'removed') {
          try {
            await purgeClipFiles(id, ownerUid);
            await db.runTransaction(async tx => {
              const fresh = await tx.get(ref);
              if (fresh.get('status') === 'removed') tx.update(ref, { mediaPurgedAt: FieldValue.serverTimestamp(),
                sourceSizeBytes: 0, processedBytes: 0, totalStorageBytes: 0 });
            });
          } catch (error) {
            // A remover may have purged before this job's last upload. Make
            // the late objects visible to removal retries and the sweeper.
            await db.runTransaction(async tx => {
              const fresh = await tx.get(ref);
              if (fresh.get('status') === 'removed') tx.update(ref, { mediaPurgedAt: null });
            });
            throw error;
          }
        }
      }
    } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  }
}

export const onClipProcessing = onDocumentUpdated({ document: 'clips/{clipId}', region: 'us-central1',
  memory: '1GiB', timeoutSeconds: 540, concurrency: 1, maxInstances: 3, retry: true }, async event => {
  const before = event.data?.before.data(), after = event.data?.after.data();
  if (!after || after.status !== 'processing') return;
  if (before?.status === 'processing' && before.renderVersion === after.renderVersion) return;
  await processClipMedia(event.params.clipId);
});

/** Firebase's client SDK may attach an original-file download token which is
 * invisible to Storage rules. Never expose it from this app and scrub both
 * new objects and owner metadata changes. There is an asynchronous window on
 * an owner's original upload; processed objects never use these tokens. */
export async function stripClipSourceToken(data: { name: string; bucket: string; generation?: string | number; metadata?: Record<string, string> }): Promise<void> {
  if (!/^clipUploads\/[^/]+\/[A-Za-z0-9_-]+\/source$/.test(data.name)) return;
  if (!data.metadata?.firebaseStorageDownloadTokens) return;
  try {
    await getStorage().bucket(data.bucket).file(data.name, { generation: data.generation == null ? undefined : String(data.generation) })
      .setMetadata({ metadata: { firebaseStorageDownloadTokens: null } });
  } catch (error) {
    if ((error as any)?.code !== 404) throw error;
  }
}
export const onClipSourceFinalized = onObjectFinalized({ region: 'us-central1', retry: true },
  async event => stripClipSourceToken(event.data));
export const onClipSourceMetadataUpdated = onObjectMetadataUpdated({ region: 'us-central1', retry: true },
  async event => stripClipSourceToken(event.data));

export async function purgeClipFiles(id: string, ownerUid: string): Promise<void> {
  clipId(id); clipId(ownerUid, 'ownerUid');
  const bucket = getStorage().bucket();
  await bucket.deleteFiles({ prefix: `clipUploads/${ownerUid}/${id}/`, force: true });
  await bucket.deleteFiles({ prefix: `clipMedia/${ownerUid}/${id}/`, force: true });
}
export const onClipRemoved = onDocumentUpdated({ document: 'clips/{clipId}', region: 'us-central1', retry: true }, async event => {
  const after = event.data?.after.data();
  if (!after || after.status !== 'removed' || after.mediaPurgedAt) return;
  await purgeClipFiles(event.params.clipId, after.ownerUid);
  await event.data!.after.ref.update({ mediaPurgedAt: FieldValue.serverTimestamp(), sourceSizeBytes: 0, processedBytes: 0, totalStorageBytes: 0 });
});

/** Bounded recovery/cleanup for abandoned local drafts and failed jobs. */
export const cleanupClipMedia = onSchedule({ schedule: 'every 60 minutes', region: 'us-central1', timeoutSeconds: 540,
  memory: '1GiB', maxInstances: 1 }, async () => {
  const db = getFirestore(), cutoff = Timestamp.fromMillis(Date.now() - 24 * 60 * 60_000);
  const stalled = await db.collection('clips').where('status', '==', 'processing')
    .where('updatedAt', '<', Timestamp.fromMillis(Date.now() - LEASE_MS - 60_000)).limit(1).get();
  for (const row of stalled.docs) await processClipMedia(row.id).catch(error =>
    console.warn('Clip processing recovery will retry', { clipId: row.id, code: (error as any)?.code }));
  const sources = await db.collection('clips').where('status', 'in', ['published', 'pending_review', 'rejected'])
    .where('sourceSizeBytes', '>', 0).limit(100).get();
  for (const row of sources.docs) {
    if (!['published', 'pending_review', 'rejected'].includes(row.get('status'))) continue;
    const source = getStorage().bucket().file(clipSourcePath(row.get('ownerUid'), row.id), { generation: row.get('sourceGeneration') });
    await source.delete({ ignoreNotFound: true });
    await db.runTransaction(async tx => {
      const fresh = await tx.get(row.ref);
      if (!fresh.exists || !['published', 'pending_review', 'rejected'].includes(fresh.get('status'))
          || fresh.get('sourceGeneration') !== row.get('sourceGeneration')) return;
      tx.update(row.ref, { sourceSizeBytes: 0, totalStorageBytes: fresh.get('processedBytes') ?? 0,
        sourceDeletedAt: FieldValue.serverTimestamp() });
    });
  }
  for (const status of ['uploading', 'failed', 'removed']) {
    let query = db.collection('clips').where('status', '==', status).where('updatedAt', '<', cutoff);
    if (status === 'removed') query = query.where('mediaPurgedAt', '==', null);
    const rows = await query.limit(50).get();
    for (const row of rows.docs) {
      const remove = await db.runTransaction(async tx => {
        const fresh = await tx.get(row.ref);
        if (fresh.get('status') !== status || millis(fresh.get('updatedAt')) >= cutoff.toMillis()) return false;
        if (status !== 'removed' && millis(fresh.get('uploadExpiresAt')) > Date.now()) return false;
        tx.update(row.ref, { status: 'removed', removedReason: 'abandoned-upload', updatedAt: FieldValue.serverTimestamp() });
        return true;
      });
      if (remove) {
        await purgeClipFiles(row.id, row.get('ownerUid'));
        await row.ref.update({ mediaPurgedAt: FieldValue.serverTimestamp(), sourceSizeBytes: 0, processedBytes: 0, totalStorageBytes: 0 });
      }
    }
  }
});
