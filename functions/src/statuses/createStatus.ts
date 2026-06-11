// Callable: post a text status.
//
// Writes go through this callable (not direct client writes) so the doc
// shape, body length, audience fields and the 24h expiry are enforced
// server-side. The author's display name/photo are snapshotted onto the
// doc so the feed never needs N user lookups.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';
import { validateTextStatusInput, STATUS_TTL_MS } from './statusLogic';

export const createStatus = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as Record<string, unknown>;
  if (data.type !== undefined && data.type !== 'text') {
    throw new HttpsError('invalid-argument', 'type-unsupported');
  }

  const input = validateTextStatusInput(data);
  if (typeof input === 'string') {
    throw new HttpsError('invalid-argument', input);
  }

  const db = getFirestore();
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'user-not-found');
  const profile = (userSnap.data() ?? {}) as { displayName?: string; photoURL?: string | null };

  const statusRef = db.collection('statuses').doc();
  const expiresAt = Timestamp.fromMillis(Date.now() + STATUS_TTL_MS);

  await statusRef.set({
    authorId:            uid,
    authorName:          profile.displayName ?? uid,
    authorPhotoURL:      profile.photoURL ?? null,
    type:                'text',
    body:                input.body,
    mediaUrl:            null,
    backgroundColor:     input.backgroundColor,
    audienceType:        input.audienceType,
    allowedViewerUids:   input.allowedViewerUids,
    excludedViewerUids:  input.excludedViewerUids,
    viewCount:           0,
    createdAt:           FieldValue.serverTimestamp(),
    expiresAt,
  });

  await writeAuditLog({
    action: 'status.created',
    actor: { uid },
    target: { type: 'status', id: statusRef.id },
    result: 'success',
    metadata: {
      statusId: statusRef.id,
      type: 'text',
      audienceType: input.audienceType,
    },
  });

  return { statusId: statusRef.id, expiresAtMs: expiresAt.toMillis() };
});
