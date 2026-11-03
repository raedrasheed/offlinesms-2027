import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { inviteGroupMembers } from './memberInvitations';

export const addMembers = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const { conversationId, memberUids } = request.data ?? {};
  if (typeof conversationId !== 'string' || !conversationId || conversationId.includes('/') || !Array.isArray(memberUids) || memberUids.some(u => typeof u !== 'string' || !u || u.includes('/'))) throw new HttpsError('invalid-argument', 'invalid-members');
  return inviteGroupMembers(conversationId, uid, memberUids);
});
