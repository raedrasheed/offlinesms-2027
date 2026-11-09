import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireClipUid, loadClipsConfig, assertActiveClipUser, assertClipMutation, assertClipGroupMember } from './access';
import { clipId, validateClipMetadata, type ClipDoc } from './model';
import { serializeClip } from './feed';

export const getClipsConfig = onCall({ region: 'us-central1' }, async request => {
  const uid = requireClipUid(request), db = getFirestore();
  const config = await loadClipsConfig(db);
  return { config, termsAccepted: (await db.doc(`clipProfiles/${uid}`).get()).get('termsVersion') === config.termsVersion };
});
export const acceptClipsTerms = onCall({ region: 'us-central1' }, async request => {
  const uid = requireClipUid(request), db = getFirestore();
  if (request.data?.expectedUid !== undefined && request.data.expectedUid !== uid)
    throw new HttpsError('failed-precondition', 'clips-account-changed');
  await assertActiveClipUser(db, uid);
  const config = await loadClipsConfig(db);
  if (request.data?.version !== config.termsVersion) throw new HttpsError('failed-precondition', 'clips-terms-version-changed');
  await db.runTransaction(async tx => {
    await assertActiveClipUser(db, uid, tx);
    tx.set(db.doc(`clipProfiles/${uid}`), { termsVersion: config.termsVersion, termsAcceptedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return { ok: true };
});
export const updateClip = onCall({ region: 'us-central1' }, async request => {
  const uid = requireClipUid(request), db = getFirestore(), config = await assertClipMutation(db, uid);
  const id = clipId(request.data?.clipId), ref = db.doc(`clips/${id}`), initial = await ref.get();
  if (!initial.exists || initial.get('ownerUid') !== uid || ['removed', 'suspended', 'uploading', 'processing'].includes(initial.get('status')))
    throw new HttpsError('not-found', 'clip-unavailable');
  const current = initial.data() as ClipDoc;
  const edit = request.data ?? {};
  const update = validateClipMetadata({
    caption: edit.caption ?? current.caption ?? '', audience: edit.audience ?? current.audience,
    groupId: edit.groupId ?? current.groupId,
    allowComments: edit.allowComments ?? current.allowComments ?? true,
    allowDownload: edit.allowDownload ?? current.allowDownload ?? false,
  });
  if (update.audience === 'group') await assertClipGroupMember(db, update.groupId!, uid);
  await db.runTransaction(async tx => {
    await assertActiveClipUser(db, uid, tx);
    const live = await tx.get(ref);
    if (!live.exists || live.get('ownerUid') !== uid || ['removed', 'suspended', 'uploading', 'processing'].includes(live.get('status')))
      throw new HttpsError('not-found', 'clip-unavailable');
    if (update.audience === 'group') await assertClipGroupMember(db, update.groupId!, uid, tx);
    // Review covers the actual caption and audience, not just the video binary.
    const contentChanged = update.caption !== live.get('caption') || update.audience !== live.get('audience') || update.groupId !== (live.get('groupId') ?? null);
    tx.update(ref, { ...update, updatedAt: FieldValue.serverTimestamp(),
      ...(contentChanged && config.moderationRequired && ['published', 'rejected'].includes(live.get('status'))
        ? { status: 'pending_review', moderationReason: null } : {}) });
  });
  return { clip: await serializeClip(db, await ref.get(), uid) };
});
export const deleteClip = onCall({ region: 'us-central1' }, async request => {
  const uid = requireClipUid(request), db = getFirestore(); await assertActiveClipUser(db, uid);
  const ref = db.doc(`clips/${clipId(request.data?.clipId)}`);
  await db.runTransaction(async tx => {
    await assertActiveClipUser(db, uid, tx);
    const row = await tx.get(ref);
    if (!row.exists || row.get('ownerUid') !== uid) throw new HttpsError('not-found', 'clip-unavailable');
    if (row.get('status') === 'removed') return;
    tx.update(ref, { status: 'removed', deletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});

export { getClipsFeed, getClip } from './feed';
export { getClipProfile, updateClipProfile, followClipCreator, listClipFollowRequests, listClipFollowers, respondClipFollowRequest, removeClipFollower } from './profiles';
export { setClipInteraction, recordClipView, reportClip } from './interactions';
export { listClipComments, addClipComment, deleteClipComment, setClipCommentLike } from './comments';
export { shareClip } from './shares';
