// Callable: leave a group.
//
// - Members and admins can always leave.
// - Owner may also leave. When other active members remain, ownership is
//   automatically transferred to the most senior member (admins first,
//   then the earliest-joined member) so the group is never left ownerless.
//   Leaving as the last member disables the conversation.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';
import { chooseOwnershipSuccessor, type SuccessorCandidate } from './leaveGroupLogic';

export const leaveGroup = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { conversationId?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId) {
    throw new HttpsError('invalid-argument', 'conversationId-required');
  }

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(data.conversationId);

  const [convoSnap, callerSnap] = await Promise.all([
    convoRef.get(),
    convoRef.collection('members').doc(uid).get(),
  ]);

  if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
  const convo = convoSnap.data() as { type?: string; participantUids?: string[]; memberCount?: number };
  if (convo.type !== 'group') throw new HttpsError('failed-precondition', 'not-a-group');

  if (!callerSnap.exists || (callerSnap.data()?.status ?? 'active') !== 'active') {
    throw new HttpsError('failed-precondition', 'not-a-member');
  }

  const callerRole = (callerSnap.data()?.role ?? 'member') as string;
  const nextParticipants = (convo.participantUids ?? []).filter(u => u !== uid);

  // When the owner leaves a group that still has members, hand ownership to
  // the most senior remaining member so the group is never left ownerless.
  let successorUid: string | null = null;
  if (callerRole === 'owner' && nextParticipants.length > 0) {
    const membersSnap = await convoRef.collection('members').get();
    const candidates: SuccessorCandidate[] = membersSnap.docs
      .filter(d => d.id !== uid)
      .map(d => {
        const m = d.data() as { role?: string; status?: string; joinedAt?: { toMillis?: () => number } };
        return { d, m };
      })
      .filter(({ m }) => (m.status ?? 'active') === 'active')
      .map(({ d, m }) => ({
        uid:        d.id,
        role:       m.role ?? 'member',
        joinedAtMs: m.joinedAt?.toMillis?.() ?? 0,
      }));
    successorUid = chooseOwnershipSuccessor(candidates);
  }

  const now = FieldValue.serverTimestamp();
  const batch = db.batch();

  if (nextParticipants.length === 0) {
    // Last person out — disable the conversation.
    batch.update(convoRef, {
      status:          'disabled',
      participantUids: nextParticipants,
      memberIds:       nextParticipants,
      memberCount:     0,
      updatedAt:       now,
    });
  } else {
    const convoUpdate: Record<string, unknown> = {
      participantUids: nextParticipants,
      memberIds:       nextParticipants,
      memberCount:     nextParticipants.length,
      updatedAt:       now,
    };
    if (successorUid) {
      convoUpdate.ownerUid = successorUid;
      batch.update(convoRef.collection('members').doc(successorUid), {
        role: 'owner',
        updatedAt: now,
      });
    }
    batch.update(convoRef, convoUpdate);
  }

  batch.update(convoRef.collection('members').doc(uid), {
    status: 'left',
    role: 'member',
    updatedAt: now,
  });

  await batch.commit();

  await writeAuditLog({
    action: 'group.member.left',
    actor: { uid },
    target: { type: 'conversation', id: convoRef.id },
    result: 'success',
    metadata: {
      conversationId: convoRef.id,
      wasRole: callerRole,
      ...(successorUid ? { ownershipTransferredTo: successorUid } : {}),
    },
  });

  return { ok: true, ...(successorUid ? { ownershipTransferredTo: successorUid } : {}) };
});
