// Fan-out: when a message is created, update the parent conversation's
// lastMessage* fields and create per-recipient receipt placeholders.
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export const onMessageCreate = onDocumentCreated(
  'conversations/{convoId}/messages/{msgId}',
  async (event) => {
    const db = getFirestore();
    const msg = event.data?.data();
    if (!msg) return;
    const { convoId, msgId } = event.params as { convoId: string; msgId: string };

    const convoRef = db.collection('conversations').doc(convoId);
    const convoSnap = await convoRef.get();
    if (!convoSnap.exists) return;
    const convo = convoSnap.data() as { memberIds?: string[] };
    const recipients = (convo.memberIds ?? []).filter(uid => uid !== msg.senderId);

    const batch = db.batch();

    // 1. Update conversation summary
    batch.update(convoRef, {
      lastMessageText: msg.type === 'text' ? msg.text : `[${msg.type}]`,
      lastMessageAt:   msg.createdAt ?? FieldValue.serverTimestamp(),
      lastSenderId:    msg.senderId,
    });

    // 2. Pending receipts for each recipient
    for (const uid of recipients) {
      const ref = convoRef.collection('messages').doc(msgId).collection('receipts').doc(uid);
      batch.set(ref, { status: 'pending', createdAt: FieldValue.serverTimestamp() });
    }

    await batch.commit();
  }
);
