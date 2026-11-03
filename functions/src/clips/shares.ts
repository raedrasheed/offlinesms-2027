import { createHash } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { clipId, type ClipDoc } from './model';
import { requireClipUid, assertClipMutation, assertCanViewClip, consumeClipRate, clipsBlocked } from './access';
import { publicClipAuthor } from './profiles';

/** Shares contain an opaque reference only. Membership does not transfer; every
 * recipient re-resolves current clip access before obtaining title or media. */
export const shareClip = onCall({ region: 'us-central1' }, async request => {
  const uid = requireClipUid(request), db = getFirestore(); await assertClipMutation(db, uid);
  const id = clipId(request.data?.clipId), conversationId = clipId(request.data?.conversationId, 'conversationId');
  const clientId = clipId(request.data?.clientId, 'clientId');
  await consumeClipRate(db, uid, 'share', 30);
  const author = await publicClipAuthor(db, uid);
  const conversationRef = db.doc(`conversations/${conversationId}`), clipRef = db.doc(`clips/${id}`);
  const messageId = createHash('sha256').update(`clip:${uid}:${clientId}`).digest('hex');
  const messageRef = conversationRef.collection('messages').doc(messageId);
  await db.runTransaction(async tx => {
    const [clip, conversation, member, previous] = await tx.getAll(clipRef, conversationRef,
      conversationRef.collection('members').doc(uid), messageRef);
    if (!clip.exists) throw new HttpsError('not-found', 'clip-unavailable');
    await assertCanViewClip(db, clip.data() as ClipDoc, uid, false, tx);
    if (clip.get('status') !== 'published') throw new HttpsError('failed-precondition', 'clip-not-published');
    const roster: string[] = conversation.get('participantUids') ?? conversation.get('memberIds') ?? [];
    if (!conversation.exists || !roster.includes(uid)) throw new HttpsError('permission-denied', 'not-a-participant');
    if (conversation.get('status') === 'disabled') throw new HttpsError('failed-precondition', 'conversation-disabled');
    const group = conversation.get('type') === 'group';
    if (group) {
      if (!member.exists || (member.get('status') ?? 'active') !== 'active') throw new HttpsError('permission-denied', 'not-an-active-member');
      const privileged = ['owner', 'admin'].includes(member.get('role'));
      if (!privileged && (conversation.get('status') === 'locked' || conversation.get('settings')?.onlyAdminsCanSend === true))
        throw new HttpsError('permission-denied', 'admins-only');
    } else {
      const peer = roster.find(p => p !== uid);
      if (peer && await clipsBlocked(db, uid, peer, tx)) throw new HttpsError('permission-denied', 'recipient-blocked');
    }
    if (previous.exists) {
      if (previous.get('senderUid') !== uid || previous.get('clipId') !== id) throw new HttpsError('already-exists', 'share-id-conflict');
      if (previous.get('deletedForEveryone') || previous.get('retentionDeleting')) throw new HttpsError('not-found', 'message-unavailable');
      return;
    }
    const now = FieldValue.serverTimestamp();
    tx.create(messageRef, {
      conversationId, senderUid: uid, senderId: uid, type: 'clip', clipId: id,
      text: '🎬 OfflineSMS Clip', status: 'sent', deletedForEveryone: false,
      editedAt: null, replyTo: null, forwarded: false, forwardedFrom: null, reactions: null,
      pinnedAt: null, pinnedBy: null, expiresAt: null, createdAt: now, updatedAt: now,
      clientLocalId: clientId, idempotencyKey: clientId,
      ...(group ? { senderDisplayName: author.displayName || null, senderPhotoURL: author.photoURL } : {}),
    });
    tx.update(clipRef, { shareCount: FieldValue.increment(1) });
    tx.set(clipRef.collection('shares').doc(`${conversationId}_${messageId}`), { senderUid: uid, conversationId, messageId, createdAt: now });
  });
  return { messageId };
});
