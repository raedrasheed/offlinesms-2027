// Callable: create a media (image | voice) message placeholder.
//
// Phase 23 — the optimistic-upload entry point. The client calls this first to
// reserve a message doc (uploadStatus 'pending'), then uploads the binary to the
// returned storagePath, then calls finalizeMediaMessage. Mirrors the membership /
// lock / admin-only / idempotency checks of sendTextMessage. Binary never passes
// through this function — metadata only. Audit carries safe metadata only (never
// the caption, which is message content).

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';
import { assertDirectNotBlocked } from './blockGuard';

const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const VOICE_MAX_MS = 5 * 60 * 1000;
const VOICE_MIN_MS = 1000;
const CAPTION_MAX = 1000;
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const AUDIO_MIME = ['audio/m4a', 'audio/aac', 'audio/mp4', 'audio/x-m4a'];

export const createMediaMessage = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as {
    conversationId?: unknown; type?: unknown; caption?: unknown;
    mimeType?: unknown; sizeBytes?: unknown;
    width?: unknown; height?: unknown; durationMs?: unknown; waveform?: unknown;
    replyTo?: unknown; localId?: unknown; idempotencyKey?: unknown;
  };

  if (typeof data.conversationId !== 'string' || !data.conversationId) {
    throw new HttpsError('invalid-argument', 'conversationId-required');
  }
  const mediaType = data.type;
  if (mediaType !== 'image' && mediaType !== 'voice') {
    throw new HttpsError('invalid-argument', 'type-invalid');
  }
  if (typeof data.mimeType !== 'string') {
    throw new HttpsError('invalid-argument', 'mimeType-required');
  }
  const mimeType = data.mimeType.toLowerCase();
  const allow = mediaType === 'image' ? IMAGE_MIME : AUDIO_MIME;
  if (!allow.includes(mimeType)) {
    throw new HttpsError('invalid-argument', 'mime-not-allowed');
  }
  const sizeBytes = typeof data.sizeBytes === 'number' ? data.sizeBytes : 0;
  if (!(sizeBytes > 0) || sizeBytes > MAX_MEDIA_BYTES) {
    throw new HttpsError('invalid-argument', 'size-invalid');
  }
  const durationMs = typeof data.durationMs === 'number' ? data.durationMs : null;
  if (mediaType === 'voice') {
    if (durationMs == null) throw new HttpsError('invalid-argument', 'duration-required');
    if (durationMs < VOICE_MIN_MS) throw new HttpsError('invalid-argument', 'duration-too-short');
    if (durationMs > VOICE_MAX_MS) throw new HttpsError('invalid-argument', 'duration-too-long');
  }
  const caption = mediaType === 'image' && typeof data.caption === 'string'
    ? data.caption.slice(0, CAPTION_MAX) : null;
  const width = typeof data.width === 'number' ? data.width : null;
  const height = typeof data.height === 'number' ? data.height : null;
  const waveform = Array.isArray(data.waveform)
    ? (data.waveform as unknown[]).filter((n): n is number => typeof n === 'number').slice(0, 60)
    : null;

  const clientLocalId = typeof data.localId === 'string' && data.localId ? data.localId : null;
  const clientIdempotencyKey = typeof data.idempotencyKey === 'string' && data.idempotencyKey
    ? data.idempotencyKey : null;

  // Optional replyTo (same shape/trust model as sendTextMessage).
  let replyTo: null | Record<string, unknown> = null;
  if (data.replyTo != null) {
    const r = data.replyTo as Record<string, unknown>;
    if (typeof r.messageId !== 'string' || !r.messageId) {
      throw new HttpsError('invalid-argument', 'replyTo.messageId-required');
    }
    replyTo = {
      messageId:         r.messageId,
      senderUid:         typeof r.senderUid === 'string' ? r.senderUid : '',
      senderDisplayName: typeof r.senderDisplayName === 'string' ? r.senderDisplayName.slice(0, 80) : '',
      preview:           typeof r.preview === 'string' ? r.preview.slice(0, 200) : '',
      type:              typeof r.type === 'string' ? r.type : 'text',
      createdAt:         r.createdAt ?? null,
    };
  }

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(data.conversationId);
  const convoSnap = await convoRef.get();
  if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
  const convo = convoSnap.data() as {
    type?: string; participantUids?: string[]; memberIds?: string[];
    status?: string; settings?: { onlyAdminsCanSend?: boolean };
  };
  const participants = convo.participantUids ?? convo.memberIds ?? [];
  if (!participants.includes(uid)) throw new HttpsError('permission-denied', 'not-a-participant');
  if (convo.status === 'disabled') throw new HttpsError('failed-precondition', 'conversation-disabled');
  // Direct chats: reject if either side has blocked the other.
  await assertDirectNotBlocked(db, convo, uid);

  const isGroup = convo.type === 'group';
  let senderDisplayName: string | null = null;
  let senderPhotoURL: string | null = null;
  if (isGroup) {
    const memberSnap = await convoRef.collection('members').doc(uid).get();
    if (!memberSnap.exists) throw new HttpsError('permission-denied', 'not-a-member');
    const member = memberSnap.data() as { role?: string; status?: string;
      displayNameSnapshot?: string; photoURLSnapshot?: string | null };
    if ((member.status ?? 'active') !== 'active') {
      throw new HttpsError('permission-denied', 'not-an-active-member');
    }
    const isPrivileged = member.role === 'owner' || member.role === 'admin';
    if (convo.status === 'locked' && !isPrivileged) throw new HttpsError('failed-precondition', 'group-locked');
    if (convo.settings?.onlyAdminsCanSend === true && !isPrivileged) throw new HttpsError('permission-denied', 'admins-only');
    senderDisplayName = member.displayNameSnapshot ?? null;
    senderPhotoURL = member.photoURLSnapshot ?? null;
    if (!senderDisplayName) {
      const userSnap = await db.collection('users').doc(uid).get();
      const u = (userSnap.data() ?? {}) as { displayName?: string; photoURL?: string };
      senderDisplayName = u.displayName ?? uid;
      senderPhotoURL = senderPhotoURL ?? u.photoURL ?? null;
    }
  }

  // Idempotency — return the existing message instead of creating a duplicate.
  if (clientLocalId) {
    const dupSnap = await convoRef.collection('messages')
      .where('clientLocalId', '==', clientLocalId).limit(1).get();
    if (!dupSnap.empty) {
      const doc = dupSnap.docs[0];
      const m = doc.data() as { media?: { storagePath?: string; thumbnailPath?: string | null } };
      return {
        messageId: doc.id,
        storagePath: m.media?.storagePath ?? null,
        thumbnailPath: m.media?.thumbnailPath ?? null,
        idempotent: true,
      };
    }
  }

  const msgRef = convoRef.collection('messages').doc();
  // The uid is embedded in the path so Storage rules can authorize the write by
  // comparing request.auth.uid to the path segment — no cross-service Firestore
  // read (mirrors the conversations/{convoId}/{senderId} pattern in storage.rules).
  const base = `chatMedia/${convoRef.id}/${uid}/${msgRef.id}`;
  const storagePath = mediaType === 'image' ? `${base}/image-original.jpg` : `${base}/voice.m4a`;
  const thumbnailPath = mediaType === 'image' ? `${base}/image-thumb.jpg` : null;
  const now = FieldValue.serverTimestamp();

  await msgRef.set({
    conversationId:     convoRef.id,
    senderUid:          uid,
    senderId:           uid,
    type:               mediaType,
    text:               null,
    caption,
    media: {
      storagePath,
      thumbnailPath,
      mimeType,
      sizeBytes,
      width,
      height,
      durationMs,
      waveform,
      uploadStatus: 'pending',
    },
    status:             'sent',
    deletedForEveryone: false,
    editedAt:           null,
    replyTo,
    forwarded:          false,
    forwardedFrom:      null,
    reactions:          null,
    pinnedAt:           null,
    pinnedBy:           null,
    expiresAt:          null,
    createdAt:          now,
    updatedAt:          now,
    clientLocalId,
    idempotencyKey:     clientIdempotencyKey,
    ...(isGroup ? { senderDisplayName, senderPhotoURL } : {}),
  });

  await writeAuditLog({
    action: 'chat.media.created',
    actor:  { uid },
    target: { type: 'message', id: msgRef.id },
    result: 'success',
    metadata: { conversationId: convoRef.id, mediaType, mimeType, sizeBytes, durationMs },
  });

  return { messageId: msgRef.id, storagePath, thumbnailPath, idempotent: false };
});
