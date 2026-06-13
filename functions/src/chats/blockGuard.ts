// Shared block enforcement for direct (1:1) conversations.
//
// Blocks are stored privately at users/{uid}/blockedUsers/{peerUid}. For a
// direct conversation, a send is rejected when either party has blocked the
// other:
//   - 'recipient-blocked'     → the sender has blocked the peer (unblock first)
//   - 'blocked-by-recipient'  → the peer has blocked the sender
// No-op for groups.

import { HttpsError } from 'firebase-functions/v2/https';

type ConvoLike = {
  type?: string;
  participantUids?: string[];
  memberIds?: string[];
};

export async function assertDirectNotBlocked(
  db: FirebaseFirestore.Firestore,
  convo: ConvoLike,
  senderUid: string,
): Promise<void> {
  if (convo.type === 'group') return;
  const participants = convo.participantUids ?? convo.memberIds ?? [];
  const peerUid = participants.find(u => u !== senderUid);
  if (!peerUid) return;

  const [iBlockedPeer, peerBlockedMe] = await Promise.all([
    db.collection('users').doc(senderUid).collection('blockedUsers').doc(peerUid).get(),
    db.collection('users').doc(peerUid).collection('blockedUsers').doc(senderUid).get(),
  ]);
  if (iBlockedPeer.exists)  throw new HttpsError('permission-denied', 'recipient-blocked');
  if (peerBlockedMe.exists) throw new HttpsError('permission-denied', 'blocked-by-recipient');
}
