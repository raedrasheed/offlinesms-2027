// Callable: forward text messages from one conversation to one or more
// targets. Text-only in Phase 6; skips deleted/non-text source messages;
// caller must be a participant in source AND every target. Group send-
// policy gates (locked / onlyAdminsCanSend) are honoured for each target.
//
// Audited as message.forwarded with counts only — never the body.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';

const MAX_SOURCE = 10;
const MAX_TARGETS = 10;
const TEXT_MAX = 4000;

export const forwardMessages = onCall(async (request) => {
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
    type: 'text';
    senderUid: string;
  };
  const forwardables: SourceMessage[] = [];
  for (const snap of msgSnaps) {
    if (!snap.exists) continue;
    const m = snap.data() as { type?: string; text?: string; deletedForEveryone?: boolean; senderUid?: string; senderId?: string };
    if (m.deletedForEveryone) continue;
    if (m.type !== 'text') continue;
    if (typeof m.text !== 'string' || m.text.length === 0) continue;
    if (m.text.length > TEXT_MAX) continue;
    forwardables.push({
      id: snap.id,
      text: m.text,
      type: 'text',
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
      senderDisplayName = memberData.displayNameSnapshot ?? null;
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
  // that don't have a per-member snapshot.
  let callerDisplayName: string | null = null;
  let callerPhotoURL:    string | null = null;
  if (targets.some(t => !t.isGroup)) {
    const userSnap = await db.collection('users').doc(uid).get();
    const u = (userSnap.data() ?? {}) as { displayName?: string; photoURL?: string };
    callerDisplayName = u.displayName ?? uid;
    callerPhotoURL    = u.photoURL ?? null;
  }

  // Write fan-out: one new message per (target, source) pair.
  const batch = db.batch();
  const now = FieldValue.serverTimestamp();

  for (const t of targets) {
    for (const src of forwardables) {
      const newRef = t.ref.collection('messages').doc();
      const senderDisplayName = t.isGroup ? t.senderDisplayName : callerDisplayName;
      const senderPhotoURL    = t.isGroup ? t.senderPhotoURL    : callerPhotoURL;

      batch.set(newRef, {
        conversationId:     t.id,
        senderUid:          uid,
        senderId:           uid,             // back-compat alias
        type:               'text',
        text:               src.text,
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
