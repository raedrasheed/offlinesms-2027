import { createHash } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { assertActiveClipUser, assertCanViewClip, assertClipGroupMember, assertClipMutation,
  assertClipsEnabled, isPlatformClipAdmin, loadClipsConfig, requireClipUid, consumeClipRate, isClipGroupMember } from './access';
import { clipId, validateClipMetadata, clipsConfig, type ClipDoc } from './model';
import { CLIP_MIME_TYPES, validateClipEdits } from './mediaTools';
import { publicNameFrom } from '../lib/displayName';

const REGION = 'us-central1';
export const CLIP_URL_TTL_MS = 120_000;
export function clipSourcePath(uid: string, id: string): string { return `clipUploads/${uid}/${id}/source`; }
export function clipOutputPath(uid: string, id: string, file: 'standard.mp4' | 'dataSaver.mp4' | 'cover.jpg'): string {
  return `clipMedia/${uid}/${id}/${file}`;
}
function validBucketContentType(value: unknown): value is string { return typeof value === 'string' && CLIP_MIME_TYPES.includes(value); }

/** Include authorization documents in the write transaction, preventing a
 * concurrent account erasure or policy change from creating a late upload. */
async function mutationPolicy(tx: Transaction, db: Firestore, uid: string) {
  const [settings, user, profile] = await tx.getAll(db.doc('systemSettings/clips'), db.doc(`users/${uid}`), db.doc(`clipProfiles/${uid}`));
  const config = clipsConfig(settings.data() ?? {}); assertClipsEnabled(config);
  if (!user.exists || user.get('status') === 'suspended' || user.get('disabled') === true
      || profile.get('suspended') === true || profile.get('deleting') === true)
    throw new HttpsError('permission-denied', 'account-unavailable');
  if (profile.get('termsVersion') !== config.termsVersion) throw new HttpsError('failed-precondition', 'clips-terms-required');
  return config;
}

/** Idempotent draft reservation. Creation and daily quota are one transaction;
 * retrying a copied local draft never consumes a second publishing allowance. */
export const initClipUpload = onCall({ region: REGION }, async request => {
  const uid = requireClipUid(request), db = getFirestore();
  const config = await assertClipMutation(db, uid);
  await consumeClipRate(db, uid, 'uploadInit', 12);
  const draftId = clipId(request.data?.draftId, 'draftId');
  const id = createHash('sha256').update(`${uid}\0${draftId}`).digest('hex').slice(0, 40);
  const ref = db.doc(`clips/${id}`), day = new Date().toISOString().slice(0, 10);
  const usageRef = db.doc(`clipProfiles/${uid}/uploadQuota/${day}`);
  const profile = (await db.doc(`users/${uid}`).get()).data() ?? {};
  const maxUploadBytes = config.maxUploadMB * 1024 * 1024;
  const existing = await db.runTransaction(async tx => {
    const [prior, usage] = await tx.getAll(ref, usageRef);
    const liveConfig = await mutationPolicy(tx, db, uid);
    if (prior.exists) {
      if (prior.get('ownerUid') !== uid || prior.get('status') === 'removed') throw new HttpsError('failed-precondition', 'clip-draft-closed');
      if (['uploading', 'failed'].includes(prior.get('status')))
        tx.update(ref, { uploadExpiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60_000), updatedAt: FieldValue.serverTimestamp() });
      return prior.data()!;
    }
    if ((usage.get('count') ?? 0) >= liveConfig.maxDailyUploads) throw new HttpsError('resource-exhausted', 'clip-upload-daily-limit');
    tx.set(usageRef, { count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const clip = {
      ownerUid: uid, ownerName: publicNameFrom(profile, uid), ownerPhotoURL: profile.photoURL ?? null,
      ownerUsername: typeof profile.username === 'string' ? profile.username : null,
      status: 'uploading', audience: 'private', groupId: null, caption: '', hashtags: [],
      allowComments: true, allowDownload: false, sourcePath: clipSourcePath(uid, id), maxUploadBytes: liveConfig.maxUploadMB * 1024 * 1024,
      uploadExpiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60_000),
      likeCount: 0, commentCount: 0, viewCount: 0, shareCount: 0,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), renderVersion: 0, mediaPurgedAt: null,
    };
    tx.create(ref, clip); return clip;
  });
  return { clipId: id, storagePath: clipSourcePath(uid, id), maxUploadBytes: Math.min(existing.maxUploadBytes ?? maxUploadBytes, maxUploadBytes),
    maxDurationSeconds: config.maxDurationSeconds, status: existing.status };
});

export const publishClip = onCall({ region: REGION }, async request => {
  const uid = requireClipUid(request), db = getFirestore(), config = await assertClipMutation(db, uid);
  const id = clipId(request.data?.clipId), ref = db.doc(`clips/${id}`);
  const metadata = validateClipMetadata(request.data ?? {});
  if (metadata.audience === 'group') await assertClipGroupMember(db, metadata.groupId!, uid);
  let edits: ReturnType<typeof validateClipEdits>;
  try { edits = validateClipEdits(request.data ?? {}, config.maxDurationSeconds); }
  catch (e) { throw new HttpsError('invalid-argument', (e as Error).message); }
  const current = await ref.get();
  if (!current.exists || current.get('ownerUid') !== uid) throw new HttpsError('not-found', 'clip-unavailable');
  // A successful call whose response was lost is safe to retry.
  if (['processing', 'pending_review', 'published'].includes(current.get('status')))
    return { clipId: id, status: current.get('status') };
  if (!['uploading', 'failed'].includes(current.get('status'))) throw new HttpsError('failed-precondition', 'clip-cannot-publish');
  await consumeClipRate(db, uid, 'publish', 12);
  const sourcePath = clipSourcePath(uid, id), file = getStorage().bucket().file(sourcePath);
  let source;
  try { [source] = await file.getMetadata(); }
  catch { throw new HttpsError('failed-precondition', 'clip-upload-incomplete'); }
  const sourceSizeBytes = Number(source.size);
  if (!Number.isSafeInteger(sourceSizeBytes) || sourceSizeBytes <= 0
      || sourceSizeBytes > Math.min(config.maxUploadMB * 1024 * 1024, current.get('maxUploadBytes'))
      || !validBucketContentType(source.contentType)) throw new HttpsError('invalid-argument', 'clip-source-invalid');
  // Scrub the specific generation that the job will consume. Do not continue
  // if this fails; source token removal is also enforced by storage triggers.
  await getStorage().bucket().file(sourcePath, { generation: source.generation })
    .setMetadata({ metadata: { firebaseStorageDownloadTokens: null } });
  const result = await db.runTransaction(async tx => {
    const fresh = await tx.get(ref);
    const liveConfig = await mutationPolicy(tx, db, uid);
    if (metadata.audience === 'group' && !(await isClipGroupMember(db, metadata.groupId!, uid, tx)))
      throw new HttpsError('permission-denied', 'clip-group-membership-required');
    if (edits.trimEndMs - edits.trimStartMs > liveConfig.maxDurationSeconds * 1000
        || sourceSizeBytes > liveConfig.maxUploadMB * 1024 * 1024) throw new HttpsError('invalid-argument', 'clip-source-invalid');
    if (fresh.get('ownerUid') !== uid) throw new HttpsError('not-found', 'clip-unavailable');
    if (['processing', 'pending_review', 'published'].includes(fresh.get('status'))) return fresh.get('status');
    if (!['uploading', 'failed'].includes(fresh.get('status'))) throw new HttpsError('failed-precondition', 'clip-cannot-publish');
    tx.update(ref, { ...metadata, edits, status: 'processing', sourcePath,
      sourceGeneration: String(source.generation), sourceSizeBytes, totalStorageBytes: sourceSizeBytes,
      renderVersion: (fresh.get('renderVersion') ?? 0) + 1, processingAttempts: 0,
      processingLeaseToken: null, processingLeaseUntil: null, errorCode: null,
      submittedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return 'processing';
  });
  return { clipId: id, status: result };
});

export interface ClipPlaybackOptions { quality?: 'standard' | 'dataSaver'; download?: boolean; thumbnailOnly?: boolean }
/** Application authorization happens before signing. A URL is a short-lived
 * bearer capability and expires after two minutes; downloaded bytes cannot be revoked. */
export async function getPlaybackUrls(db: Firestore, id: string, uid: string, claims: Record<string, unknown>, options: ClipPlaybackOptions = {}) {
  const admin = isPlatformClipAdmin(claims), config = await loadClipsConfig(db);
  await assertActiveClipUser(db, uid);
  if (!admin) assertClipsEnabled(config);
  const snap = await db.doc(`clips/${id}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'clip-unavailable');
  const clip = snap.data() as ClipDoc;
  await assertCanViewClip(db, clip, uid, admin);
  if (!['published', 'pending_review', 'rejected'].includes(clip.status)) throw new HttpsError('failed-precondition', 'clip-not-ready');
  if (options.download && clip.ownerUid !== uid && !admin && clip.allowDownload !== true)
    throw new HttpsError('permission-denied', 'clip-download-disabled');
  const quality = options.quality === 'dataSaver' ? 'dataSaver' : 'standard';
  const coverPath = clipOutputPath(clip.ownerUid, id, 'cover.jpg');
  const videoPath = clipOutputPath(clip.ownerUid, id, quality === 'dataSaver' ? 'dataSaver.mp4' : 'standard.mp4');
  if (clip.coverPath !== coverPath || clip[quality === 'dataSaver' ? 'dataSaverPath' : 'standardPath'] !== videoPath)
    throw new HttpsError('failed-precondition', 'clip-media-path-invalid');
  const expiresAtMs = Date.now() + CLIP_URL_TTL_MS, bucket = getStorage().bucket();
  const [thumbnailUrl] = await bucket.file(coverPath).getSignedUrl({ version: 'v4', action: 'read', expires: expiresAtMs });
  let url: string | null = null;
  if (!options.thumbnailOnly) [url] = await bucket.file(videoPath).getSignedUrl({ version: 'v4', action: 'read', expires: expiresAtMs,
    ...(options.download ? { responseDisposition: `attachment; filename="OfflineSMS-${id}.mp4"` } : {}) });
  return { url, thumbnailUrl, expiresAtMs, durationMs: Number(clip.durationMs) || 0, quality };
}

export const getClipPlayback = onCall({ region: REGION }, async request => {
  const uid = requireClipUid(request), data = request.data ?? {};
  const id = clipId(data.clipId);
  if (data.quality !== undefined && !['standard', 'dataSaver'].includes(data.quality)) throw new HttpsError('invalid-argument', 'clip-quality-invalid');
  return getPlaybackUrls(getFirestore(), id, uid, request.auth?.token ?? {}, {
    quality: data.quality, download: data.download === true, thumbnailOnly: data.thumbnailOnly === true,
  });
});
export const getClipThumbnails = onCall({ region: REGION }, async request => {
  const uid = requireClipUid(request), ids = request.data?.clipIds;
  if (!Array.isArray(ids) || ids.length > 30) throw new HttpsError('invalid-argument', 'clip-ids-invalid');
  const result: Array<{ clipId: string; thumbnailUrl: string; expiresAtMs: number }> = [];
  const db = getFirestore();
  for (const value of [...new Set(ids)]) {
    const id = clipId(value);
    try {
      const item = await getPlaybackUrls(db, id, uid, request.auth?.token ?? {}, { thumbnailOnly: true });
      result.push({ clipId: id, thumbnailUrl: item.thumbnailUrl, expiresAtMs: item.expiresAtMs });
    } catch (error) {
      if (!(error instanceof HttpsError) || !['not-found', 'permission-denied', 'failed-precondition'].includes(error.code)) throw error;
    }
  }
  return { items: result };
});
