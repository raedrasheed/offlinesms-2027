// Callable: update a group's info (name, description, avatar). Owner/admin only.
//
// Mirrors lockGroup's auth + role gate. Only the fields present in the request
// are changed; passing description/avatarUrl = null clears them. The avatar
// image itself is uploaded by the client to Storage; this only stores the URL.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';

const NAME_MAX = 80;
const DESCRIPTION_MAX = 500;

export const updateGroupInfo = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as {
    conversationId?: unknown; name?: unknown; description?: unknown; avatarUrl?: unknown;
  };
  if (typeof data.conversationId !== 'string' || !data.conversationId) {
    throw new HttpsError('invalid-argument', 'conversationId-required');
  }

  // Build the patch from only the provided fields.
  const patch: Record<string, unknown> = {};
  const changed: string[] = [];

  if (data.name !== undefined) {
    if (typeof data.name !== 'string') throw new HttpsError('invalid-argument', 'name-invalid');
    const name = data.name.trim();
    if (name.length === 0) throw new HttpsError('invalid-argument', 'name-empty');
    if (name.length > NAME_MAX) throw new HttpsError('invalid-argument', 'name-too-long');
    patch.name = name;
    changed.push('name');
  }
  if (data.description !== undefined) {
    if (data.description === null) { patch.description = null; changed.push('description'); }
    else if (typeof data.description === 'string') {
      const desc = data.description.trim();
      if (desc.length > DESCRIPTION_MAX) throw new HttpsError('invalid-argument', 'description-too-long');
      patch.description = desc.length > 0 ? desc : null;
      changed.push('description');
    } else throw new HttpsError('invalid-argument', 'description-invalid');
  }
  if (data.avatarUrl !== undefined) {
    if (data.avatarUrl === null) { patch.avatarUrl = null; changed.push('avatar'); }
    else if (typeof data.avatarUrl === 'string' && data.avatarUrl.length > 0) {
      patch.avatarUrl = data.avatarUrl;
      changed.push('avatar');
    } else throw new HttpsError('invalid-argument', 'avatarUrl-invalid');
  }

  if (changed.length === 0) throw new HttpsError('invalid-argument', 'nothing-to-update');

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(data.conversationId);

  const [convoSnap, callerSnap] = await Promise.all([
    convoRef.get(),
    convoRef.collection('members').doc(uid).get(),
  ]);

  if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
  if ((convoSnap.data() as { type?: string }).type !== 'group') {
    throw new HttpsError('failed-precondition', 'not-a-group');
  }
  const callerRole = (callerSnap.data()?.role ?? '') as string;
  if (callerRole !== 'owner' && callerRole !== 'admin') {
    throw new HttpsError('permission-denied', 'admins-only');
  }

  patch.updatedAt = FieldValue.serverTimestamp();
  await convoRef.update(patch);

  await writeAuditLog({
    action: 'group.info.updated',
    actor: { uid },
    target: { type: 'conversation', id: convoRef.id },
    result: 'success',
    metadata: { conversationId: convoRef.id, changed },
  });

  return { ok: true };
});
