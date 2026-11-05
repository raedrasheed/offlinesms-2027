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

  // Membership, the media-access roster and ownership must commit from one
  // consistent snapshot, including when another member leaves or is removed.
  const { callerRole, successorUid } = await db.runTransaction(async tx => {
    const [convoSnap, callerSnap] = await tx.getAll(
      convoRef,
      convoRef.collection('members').doc(uid),
    );

    if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
    const convo = convoSnap.data() as { type?: string; participantUids?: string[] };
    if (convo.type !== 'group') throw new HttpsError('failed-precondition', 'not-a-group');

    if (!callerSnap.exists || (callerSnap.data()?.status ?? 'active') !== 'active') {
      throw new HttpsError('failed-precondition', 'not-a-member');
    }

    const role = (callerSnap.data()?.role ?? 'member') as string;
    const nextParticipants = (convo.participantUids ?? []).filter(u => u !== uid);

    let successor: string | null = null;
    if (role === 'owner' && nextParticipants.length > 0) {
      const membersSnap = await tx.get(convoRef.collection('members'));
      const candidates: SuccessorCandidate[] = membersSnap.docs
        .filter(d => nextParticipants.includes(d.id))
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
      successor = chooseOwnershipSuccessor(candidates);
    }

    const now = FieldValue.serverTimestamp();
    const convoUpdate: Record<string, unknown> = {
      participantUids: nextParticipants,
      memberIds:       nextParticipants,
      memberCount:     nextParticipants.length,
      updatedAt:       now,
    };
    if (nextParticipants.length === 0) {
      convoUpdate.status = 'disabled';
    } else if (successor) {
      convoUpdate.ownerUid = successor;
      tx.update(convoRef.collection('members').doc(successor), {
        role: 'owner',
        updatedAt: now,
      });
    }
    tx.update(convoRef, convoUpdate);
    tx.update(convoRef.collection('members').doc(uid), {
      status: 'left',
      role: 'member',
      updatedAt: now,
    });
    return { callerRole: role, successorUid: successor };
  });

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
