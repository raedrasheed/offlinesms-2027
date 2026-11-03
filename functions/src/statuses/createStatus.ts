// Callable: post a status (text, image or video).
//
// Writes go through this callable (not direct client writes) so the doc
// shape, body/caption length, media metadata, audience fields and the 24h
// expiry are enforced server-side. For media statuses the client uploads
// the binary to statuses/{uid}/... FIRST (storage.rules: owner-only,
// ≤15MB, image/video MIME) and then calls this with the metadata — the
// binary never passes through the function. The author's display
// name/photo are snapshotted onto the doc so the feed never needs N user
// lookups.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';
import { publicNameFrom } from '../lib/displayName';
import { writeSocialActivity } from '../social/activityModel';
import {
  validateTextStatusInput, validateMediaStatusInput, STATUS_TTL_MS, parseStatusMentionUids, isStatusAudienceMember,
} from './statusLogic';

export const createStatus = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as Record<string, unknown>;
  const type = data.type === undefined ? 'text' : data.type;
  if (type !== 'text' && type !== 'image' && type !== 'video') {
    throw new HttpsError('invalid-argument', 'type-unsupported');
  }

  const input = type === 'text'
    ? validateTextStatusInput(data)
    : validateMediaStatusInput(data, uid);
  if (typeof input === 'string') {
    throw new HttpsError('invalid-argument', input);
  }

  const db = getFirestore();
  const mentionUids = parseStatusMentionUids(data.mentionUids);
  if (typeof mentionUids === 'string') throw new HttpsError('invalid-argument', mentionUids);
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists || (userSnap.get('status') ?? 'active') !== 'active' || userSnap.get('disabled') === true) throw new HttpsError('not-found', 'user-not-found');
  const profile = (userSnap.data() ?? {}) as { displayName?: string; username?: string; photoURL?: string | null };

  const mentions: { uid: string; name: string; username: string | null }[] = [];
  for (const mentionedUid of mentionUids) {
    if (mentionedUid === uid || !isStatusAudienceMember(input, mentionedUid)) throw new HttpsError('invalid-argument', 'mention-unavailable');
    const [person, outgoingBlock, incomingBlock] = await db.getAll(db.doc(`users/${mentionedUid}`), db.doc(`users/${uid}/blockedUsers/${mentionedUid}`), db.doc(`users/${mentionedUid}/blockedUsers/${uid}`));
    if (!person.exists || (person.get('status') ?? 'active') !== 'active' || person.get('disabled') === true || outgoingBlock.exists || incomingBlock.exists) throw new HttpsError('invalid-argument', 'mention-unavailable');
    mentions.push({ uid: mentionedUid, name: publicNameFrom(person.data(), mentionedUid) ?? '', username: person.get('username') ?? null });
  }

  const statusRef = db.collection('statuses').doc();
  const expiresAt = Timestamp.fromMillis(Date.now() + STATUS_TTL_MS);

  const media = 'mediaUrl' in input
    ? input
    : { mediaUrl: null, storagePath: null, mimeType: null, sizeBytes: null, durationMs: null };

  const batch = db.batch();
  batch.set(statusRef, {
    authorId:            uid,
    authorName:          publicNameFrom(profile, uid), // null, never the uid
    authorPhotoURL:      profile.photoURL ?? null,
    type,
    body:                input.body,
    mediaUrl:            media.mediaUrl,
    storagePath:         media.storagePath,
    mimeType:            media.mimeType,
    sizeBytes:           media.sizeBytes,
    durationMs:          media.durationMs,
    backgroundColor:     'backgroundColor' in input ? input.backgroundColor : null,
    audienceType:        input.audienceType,
    allowedViewerUids:   input.allowedViewerUids,
    excludedViewerUids:  input.excludedViewerUids,
    viewCount:           0,
    likeCount:           0,
    mentions,
    createdAt:           FieldValue.serverTimestamp(),
    expiresAt,
  });
  for (const mention of mentions) writeSocialActivity(db, batch, mention.uid, { kind: 'statusMention', actorUid: uid, statusId: statusRef.id });
  await batch.commit();

  await writeAuditLog({
    action: 'status.created',
    actor: { uid },
    target: { type: 'status', id: statusRef.id },
    result: 'success',
    metadata: {
      statusId: statusRef.id,
      type,
      audienceType: input.audienceType,
    },
  });

  return { statusId: statusRef.id, expiresAtMs: expiresAt.toMillis() };
});
