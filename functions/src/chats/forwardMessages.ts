// Callable: forward text messages from one conversation to one or more
// targets. Text-only in Phase 6; skips deleted/non-text source messages;
// caller must be a participant in source AND every target. Group send-
// policy gates (locked / onlyAdminsCanSend) are honoured for each target.
//
// Audited as message.forwarded with counts only — never the body.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';
import { cleanNameSnapshot, publicNameFrom } from '../lib/displayName';
import { assertDirectNotBlocked } from './blockGuard';

import { getStorage } from 'firebase-admin/storage';
import { randomUUID } from 'node:crypto';
import { isBinaryAttachment, MIME_EXTENSIONS } from './attachmentModel';

const MAX_SOURCE = 10;
const MAX_TARGETS = 10;
const TEXT_MAX = 4000;

export const forwardMessages = onCall({timeoutSeconds:180}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as {
    sourceConversationId?: unknown;
    messageIds?: unknown;
    targetConversationIds?: unknown;
  };
  if (typeof data.sourceConversationId !== 'string' || !data.sourceConversationId)
    throw new HttpsError('invalid-argument', 'sourceConversationId-required');
  if (!Array.isArray(data.messageIds) || data.messageIds.length === 0)
    throw new HttpsError('invalid-argument', 'messageIds-required');
  if (!Array.isArray(data.targetConversationIds) || data.targetConversationIds.length === 0)
    throw new HttpsError('invalid-argument', 'targetConversationIds-required');

  const messageIds = (data.messageIds as unknown[])
    .filter((x): x is string => typeof x === 'string' && x.length > 0);
  const targetIds = (data.targetConversationIds as unknown[])
    .filter((x): x is string => typeof x === 'string' && x.length > 0);

  if (messageIds.length === 0)  throw new HttpsError('invalid-argument', 'messageIds-empty');
  if (targetIds.length === 0)   throw new HttpsError('invalid-argument', 'targetConversationIds-empty');
  if (messageIds.length > MAX_SOURCE) throw new HttpsError('invalid-argument', 'too-many-messages');
  if (targetIds.length > MAX_TARGETS) throw new HttpsError('invalid-argument', 'too-many-targets');

  const db = getFirestore();
  const sourceRef = db.collection('conversations').doc(data.sourceConversationId);
  const sourceSnap = await sourceRef.get();
  if (!sourceSnap.exists) throw new HttpsError('not-found', 'source-not-found');
  const sourceConvo = sourceSnap.data() as { participantUids?: string[]; memberIds?: string[] };
  const sourceParticipants = sourceConvo.participantUids ?? sourceConvo.memberIds ?? [];
  if (!sourceParticipants.includes(uid)) {
    throw new HttpsError('permission-denied', 'not-a-source-participant');
  }

  // Resolve source messages — skip deleted / non-text.
  const msgSnaps = await Promise.all(messageIds.map(id => sourceRef.collection('messages').doc(id).get()));
  type SourceMessage = {
    id: string;
    text: string;
    type: string;
    location?: unknown; contact?: unknown; sticker?: unknown;
    media?: Record<string, any>; caption?: string | null;
    senderUid: string;
  };
  const forwardables: SourceMessage[] = [];
  for (const snap of msgSnaps) {
    if (!snap.exists) continue;
    const m = snap.data() as { type?: string; text?: string; deletedForEveryone?: boolean; senderUid?: string; senderId?: string; location?: unknown; contact?: unknown; sticker?: unknown; media?: Record<string, any>; caption?: string | null };
    if (m.deletedForEveryone) continue;
    if (!['text','location','contact','sticker'].includes(m.type ?? '') && !isBinaryAttachment(m.type)) continue;
    if (isBinaryAttachment(m.type) && (m.media?.uploadStatus !== 'uploaded' || !m.media?.storagePath)) continue;
    if (!isBinaryAttachment(m.type) && (typeof m.text !== 'string' || m.text.length === 0)) continue;
    if ((m.text?.length ?? 0) > TEXT_MAX) continue;
    forwardables.push({
      id: snap.id,
      text: m.text ?? m.type ?? 'Attachment',
      ...(m.media ? {media:m.media,caption:m.caption ?? null} : {}),
      type: m.type!,
      ...(m.location ? {location:m.location} : {}),
      ...(m.contact ? {contact:m.contact} : {}),
      ...(m.sticker ? {sticker:m.sticker} : {}),
      senderUid: m.senderUid ?? m.senderId ?? '',
    });
  }
  if (forwardables.length === 0) {
    throw new HttpsError('failed-precondition', 'nothing-to-forward');
  }

  // Validate every target — caller must be an allowed sender.
  type Target = {
    id: string;
    ref: FirebaseFirestore.DocumentReference;
    isGroup: boolean;
    role: string | null;
    senderDisplayName: string | null;
    senderPhotoURL:    string | null;
    status: string;
    settings: { onlyAdminsCanSend?: boolean };
  };
  const targets: Target[] = [];
  for (const tid of targetIds) {
    const ref = db.collection('conversations').doc(tid);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', `target-not-found:${tid}`);
    const t = snap.data() as {
      type?: string;
      status?: string;
      participantUids?: string[];
      memberIds?: string[];
      settings?: { onlyAdminsCanSend?: boolean };
    };
    const parts = t.participantUids ?? t.memberIds ?? [];
    if (!parts.includes(uid)) {
      throw new HttpsError('permission-denied', `not-a-target-participant:${tid}`);
    }
    if (t.status === 'disabled') {
      throw new HttpsError('failed-precondition', `target-disabled:${tid}`);
    }
    // Direct targets: reject if either side has blocked the other.
    await assertDirectNotBlocked(db, t, uid);
    let role: string | null = null;
    let senderDisplayName: string | null = null;
    let senderPhotoURL: string | null = null;
    const isGroup = t.type === 'group';
    if (isGroup) {
      const m = await ref.collection('members').doc(uid).get();
      if (!m.exists || (m.data()?.status ?? 'active') !== 'active') {
        throw new HttpsError('permission-denied', `not-a-target-member:${tid}`);
      }
      role = (m.data()?.role ?? 'member') as string;
      const isPriv = role === 'owner' || role === 'admin';
      if (t.status === 'locked' && !isPriv) {
        throw new HttpsError('failed-precondition', `target-locked:${tid}`);
      }
      if (t.settings?.onlyAdminsCanSend === true && !isPriv) {
        throw new HttpsError('permission-denied', `target-admins-only:${tid}`);
      }
      const memberData = m.data() as { displayNameSnapshot?: string; photoURLSnapshot?: string | null };
      senderDisplayName = cleanNameSnapshot(memberData.displayNameSnapshot, uid);
      senderPhotoURL    = memberData.photoURLSnapshot    ?? null;
    }
    targets.push({
      id: tid,
      ref,
      isGroup,
      role,
      senderDisplayName,
      senderPhotoURL,
      status: t.status ?? 'active',
      settings: t.settings ?? {},
    });
  }

  // Resolve caller display name / photo once for direct-conversation forwards
  // and group targets whose member snapshot has no usable name. Never the uid.
  let callerDisplayName: string | null = null;
  let callerPhotoURL:    string | null = null;
  if (targets.some(t => !t.isGroup || !t.senderDisplayName)) {
    const userSnap = await db.collection('users').doc(uid).get();
    const u = (userSnap.data() ?? {}) as { displayName?: string; username?: string; photoURL?: string };
    callerDisplayName = publicNameFrom(u, uid);
    callerPhotoURL    = u.photoURL ?? null;
  }

  // Write fan-out: one new message per (target, source) pair.
  const batch = db.batch();
  const now = FieldValue.serverTimestamp();

  const copies: string[] = [];
  try {
  for (const t of targets) {
    for (const src of forwardables) {
      const newRef = t.ref.collection('messages').doc();
      const senderDisplayName = t.isGroup ? (t.senderDisplayName ?? callerDisplayName) : callerDisplayName;
      const senderPhotoURL    = t.isGroup ? t.senderPhotoURL    : callerPhotoURL;

      let media: Record<string, any> | null = null;
      if (src.media) {
        const original = src.media.storagePath;
        const expected = `chatMedia/${data.sourceConversationId}/${src.senderUid}/${src.id}/`;
        if (typeof original !== 'string' || !original.startsWith(expected)) throw new HttpsError('failed-precondition','source-media-path-invalid');
        const path = `chatMedia/${t.id}/${uid}/${newRef.id}/attachment.${MIME_EXTENSIONS[src.media.mimeType] ?? 'bin'}`;
        const file = getStorage().bucket().file(path);
        await getStorage().bucket().file(original).copy(file);
        copies.push(path);
        const token=randomUUID();
        await file.setMetadata({metadata:{firebaseStorageDownloadTokens:token}});
        media = {...src.media,storagePath:path,downloadURL:`https://firebasestorage.googleapis.com/v0/b/${file.bucket.name}/o/${encodeURIComponent(file.name)}?alt=media&token=${token}`,thumbnailPath:null,thumbnailURL:null,uploadStatus:'uploaded'};
      }
      batch.set(newRef, {
        conversationId:     t.id,
        senderUid:          uid,
        senderId:           uid,             // back-compat alias
        type:               src.type,
        text:               src.text,
        ...(src.location ? {location:src.location} : {}),
        ...(src.contact ? {contact:src.contact} : {}),
        ...(src.sticker ? {sticker:src.sticker} : {}),
        ...(media ? {media,caption:src.caption ?? null} : {}),
        status:             'sent',
        deletedForEveryone: false,
        editedAt:           null,
        replyTo:            null,
        forwarded:          true,
        forwardedFrom: {
          conversationId: data.sourceConversationId,
          messageId:      src.id,
          senderUid:      src.senderUid,
        },
        createdAt:          now,
        updatedAt:          now,
        ...(t.isGroup ? { senderDisplayName, senderPhotoURL } : {}),
      });
    }
  }

  await batch.commit();
  } catch (error) {
    // A commit timeout can be ambiguous: never remove an object referenced by
    // a committed target message. Remove only definitely uncommitted copies.
    await Promise.all(copies.map(async path => {
      const parts=path.split('/');
      try {
        const message=await db.doc(`conversations/${parts[1]}/messages/${parts[3]}`).get();
        if (!message.exists) await getStorage().bucket().file(path).delete({ignoreNotFound:true});
      } catch { /* Leave uncertain objects for a storage cleanup job. */ }
    }));
    throw error;
  }

  await writeAuditLog({
    action: 'message.forwarded',
    actor:  { uid },
    target: { type: 'conversation', id: data.sourceConversationId },
    result: 'success',
    metadata: {
      from:  data.sourceConversationId,
      to:    targets.length,
      count: forwardables.length,
    },
  });

  return {
    ok: true,
    forwarded: forwardables.length,
    targets:   targets.length,
  };
});
