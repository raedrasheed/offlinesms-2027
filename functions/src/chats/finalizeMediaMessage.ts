// Finalize only after checking the actual Storage object; never trust client size/URL.
import { randomUUID } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { writeAuditLog } from '../lib/auditLog';
import { isBinaryAttachment, attachmentLimit, attachmentMimeAllowed, validCustomStickerMetadata } from './attachmentModel';
import { assertDirectNotBlocked } from './blockGuard';
import { signatureMatches, validStickerPngHeader } from './attachmentIntegrity';

export const finalizeMediaMessage = onCall(async request => {
  const uid=request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated','sign-in-required');
  const {conversationId,messageId}=request.data ?? {};
  if (typeof conversationId !== 'string' || !conversationId || conversationId.includes('/') || typeof messageId !== 'string' || !messageId || messageId.includes('/')) throw new HttpsError('invalid-argument','message-identifiers-required');
  const db=getFirestore();
  const ref=db.collection('conversations').doc(conversationId).collection('messages').doc(messageId);
  const snap=await ref.get();
  const m=snap.data();
  if (!m || m.retentionDeleting || m.deletedForEveryone) throw new HttpsError('not-found','message-not-found');
  if ((m.senderUid ?? m.senderId) !== uid) throw new HttpsError('permission-denied','not-the-sender');
  if (!isBinaryAttachment(m.type)) throw new HttpsError('failed-precondition','not-a-media-message');
  if (m.media?.uploadStatus === 'uploaded') return {messageId,idempotent:true,downloadURL:m.media.downloadURL};
  const path=m.media?.storagePath;
  if (typeof path !== 'string' || !path.startsWith(`chatMedia/${conversationId}/${uid}/${messageId}/`)) throw new HttpsError('failed-precondition','storage-path-invalid');
  const convo=await db.collection('conversations').doc(conversationId).get();
  const c=convo.data();
  if (!(c?.participantUids ?? c?.memberIds ?? []).includes(uid)) throw new HttpsError('permission-denied','not-a-participant');
  if (c?.status === 'disabled') throw new HttpsError('failed-precondition','conversation-disabled');
  await assertDirectNotBlocked(db,c!,uid);
  if (c?.type === 'group') {
    const member=await db.doc(`conversations/${conversationId}/members/${uid}`).get();
    const role=member.get('role');
    if (!member.exists || (member.get('status') ?? 'active') !== 'active') throw new HttpsError('permission-denied','not-an-active-member');
    if (role !== 'admin' && role !== 'owner' && (c.status === 'locked' || c.settings?.onlyAdminsCanSend)) throw new HttpsError('permission-denied','group-restricted');
  }
  const file=getStorage().bucket().file(path);
  let metadata;
  try {[metadata]=await file.getMetadata();} catch {throw new HttpsError('failed-precondition','upload-missing');}
  const size=Number(metadata.size),mime=metadata.contentType ?? '';
  if (!Number.isSafeInteger(size) || size <= 0 || size > attachmentLimit(m.type) || size !== m.media.sizeBytes || mime !== m.media.mimeType || !attachmentMimeAllowed(m.type,mime)) throw new HttpsError('invalid-argument','uploaded-metadata-mismatch');
  const [header]=await file.download({start:0,end:Math.min(size-1,511)});
  if (!signatureMatches(mime,header)) throw new HttpsError('invalid-argument','file-signature-invalid');
  if (m.media.presentation === 'sticker' && (m.type !== 'image' || !validCustomStickerMetadata({...m.media,mimeType:mime,sizeBytes:size})
    || !validStickerPngHeader(header))) throw new HttpsError('invalid-argument','sticker-invalid');
  // Generate a URL for this verified object, not for an arbitrary client URL.
  let token = String(metadata.metadata?.firebaseStorageDownloadTokens ?? '').split(',')[0];
  if (!token) { token=randomUUID(); await file.setMetadata({metadata:{firebaseStorageDownloadTokens:token}}); }
  const downloadURL=`https://firebasestorage.googleapis.com/v0/b/${file.bucket.name}/o/${encodeURIComponent(file.name)}?alt=media&token=${encodeURIComponent(token)}`;
  await db.runTransaction(async tx => {
    const latest=await tx.get(ref);
    if (!latest.exists || latest.get('retentionDeleting') || latest.get('deletedForEveryone')) throw new HttpsError('not-found','message-not-found');
    tx.update(ref,{'media.uploadStatus':'uploaded','media.downloadURL':downloadURL,'media.sizeBytes':size,updatedAt:FieldValue.serverTimestamp()});
  });
  void writeAuditLog({action:'chat.media.finalized',actor:{uid},target:{type:'message',id:messageId},result:'success',metadata:{conversationId,mediaType:m.type}}).catch(() => {});
  return {messageId,idempotent:false,downloadURL};
});
