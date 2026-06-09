// Group invite links (Phase 26).
//
// Data model:
//   conversations/{id}/inviteSettings/current     — canonical settings
//   inviteCodes/{code}                             — locked reverse index for
//                                                    O(1) resolve + instant
//                                                    revocation (delete = 404)
//   conversations/{id}/joinRequests/{requesterUid} — one request per user
//
// All sensitive writes are Admin-SDK only (rules lock the client out). Resolve
// + join run through callables so the client never reads inviteCodes directly
// and never sees the private member list.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';
import { MAX_GROUP_MEMBERS } from './createGroup';
import {
  generateInviteCode, isValidInviteCode, joinDecision, inviteUsable,
  buildInvitePreview, inviteUrl, type InviteJoinMode,
} from './inviteLogic';

function isJoinMode(x: unknown): x is InviteJoinMode {
  return x === 'open' || x === 'approval_required';
}

async function requireGroupAdmin(uid: string, conversationId: string) {
  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(conversationId);
  const [convoSnap, callerSnap] = await Promise.all([
    convoRef.get(),
    convoRef.collection('members').doc(uid).get(),
  ]);
  if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
  const convo = convoSnap.data() as { type?: string };
  if (convo.type !== 'group') throw new HttpsError('failed-precondition', 'not-a-group');
  const role = (callerSnap.data()?.role ?? '') as string;
  const active = (callerSnap.data()?.status ?? 'active') === 'active';
  if (!active || (role !== 'owner' && role !== 'admin')) {
    throw new HttpsError('permission-denied', 'admins-only');
  }
  return { db, convoRef };
}

/** Lightweight fixed-window rate limit. Throws resource-exhausted when tripped. */
async function rateLimit(scope: string, uid: string, max: number, windowMs: number) {
  const db = getFirestore();
  const ref = db.collection('rateLimits').doc(`${scope}_${uid}`);
  const now = Date.now();
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const data = snap.data() as { windowStart?: number; count?: number } | undefined;
    const start = data?.windowStart ?? 0;
    if (now - start > windowMs) {
      tx.set(ref, { windowStart: now, count: 1 }, { merge: true });
      return;
    }
    const count = (data?.count ?? 0) + 1;
    if (count > max) throw new HttpsError('resource-exhausted', 'rate-limited');
    tx.set(ref, { count }, { merge: true });
  });
}

// ─── Admin: create / update / reset ─────────────────────────────────────────

export const createOrUpdateGroupInviteLink = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const data = (request.data ?? {}) as { conversationId?: unknown; enabled?: unknown; joinMode?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId) throw new HttpsError('invalid-argument', 'conversationId-required');
  if (typeof data.enabled !== 'boolean') throw new HttpsError('invalid-argument', 'enabled-required');
  if (!isJoinMode(data.joinMode)) throw new HttpsError('invalid-argument', 'joinMode-invalid');

  const { db, convoRef } = await requireGroupAdmin(uid, data.conversationId);
  const settingsRef = convoRef.collection('inviteSettings').doc('current');
  const cur = (await settingsRef.get()).data() as { inviteCode?: string; createdAt?: unknown } | undefined;

  const code = cur?.inviteCode ?? generateInviteCode();
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(settingsRef, {
    enabled: data.enabled,
    inviteCode: code,
    joinMode: data.joinMode,
    createdByUid: cur?.inviteCode ? undefined : uid,
    createdAt: cur?.createdAt ? undefined : now,
    updatedAt: now,
    revokedAt: null,
  }, { merge: true });
  batch.set(db.collection('inviteCodes').doc(code), {
    conversationId: convoRef.id, joinMode: data.joinMode, enabled: data.enabled,
    createdByUid: uid, createdAt: now, revokedAt: null,
  }, { merge: true });
  await batch.commit();

  void writeAuditLog({
    action: 'group.invite.upserted', actor: { uid }, target: { type: 'conversation', id: convoRef.id },
    result: 'success', metadata: { enabled: data.enabled, joinMode: data.joinMode },
  }).catch(() => {});

  return { inviteCode: code, enabled: data.enabled, joinMode: data.joinMode, url: inviteUrl(code) };
});

export const resetGroupInviteLink = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const data = (request.data ?? {}) as { conversationId?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId) throw new HttpsError('invalid-argument', 'conversationId-required');

  const { db, convoRef } = await requireGroupAdmin(uid, data.conversationId);
  const settingsRef = convoRef.collection('inviteSettings').doc('current');
  const cur = (await settingsRef.get()).data() as { inviteCode?: string; joinMode?: InviteJoinMode; enabled?: boolean } | undefined;

  const newCode = generateInviteCode();
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  // Delete the old reverse-index doc so old links immediately stop resolving.
  if (cur?.inviteCode) batch.delete(db.collection('inviteCodes').doc(cur.inviteCode));
  batch.set(settingsRef, { inviteCode: newCode, updatedAt: now, revokedAt: null }, { merge: true });
  batch.set(db.collection('inviteCodes').doc(newCode), {
    conversationId: convoRef.id, joinMode: cur?.joinMode ?? 'open', enabled: cur?.enabled ?? true,
    createdByUid: uid, createdAt: now, revokedAt: null,
  });
  await batch.commit();

  void writeAuditLog({
    action: 'group.invite.reset', actor: { uid }, target: { type: 'conversation', id: convoRef.id }, result: 'success',
  }).catch(() => {});

  return { inviteCode: newCode, url: inviteUrl(newCode) };
});

// ─── Resolve (preview) ──────────────────────────────────────────────────────

export const resolveGroupInviteLink = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const data = (request.data ?? {}) as { inviteCode?: unknown };
  if (!isValidInviteCode(data.inviteCode)) throw new HttpsError('invalid-argument', 'invite-invalid');

  const db = getFirestore();
  const codeSnap = await db.collection('inviteCodes').doc(data.inviteCode).get();
  if (!codeSnap.exists) throw new HttpsError('not-found', 'invite-not-found');
  const code = codeSnap.data() as { conversationId: string; joinMode: InviteJoinMode; enabled?: boolean; revokedAt?: unknown };

  const convoRef = db.collection('conversations').doc(code.conversationId);
  const [convoSnap, memberSnap, reqSnap] = await Promise.all([
    convoRef.get(),
    convoRef.collection('members').doc(uid).get(),
    convoRef.collection('joinRequests').doc(uid).get(),
  ]);
  if (!convoSnap.exists) throw new HttpsError('not-found', 'group-not-found');
  const convo = convoSnap.data() as { name?: string; photoURL?: string; memberCount?: number };

  const isMember = memberSnap.exists && (memberSnap.get('status') ?? 'active') === 'active';
  const hasPending = reqSnap.exists && reqSnap.get('status') === 'pending';

  return buildInvitePreview({
    conversationId: code.conversationId,
    groupName: convo.name, groupPhotoURL: convo.photoURL ?? null, memberCount: convo.memberCount,
    joinMode: code.joinMode,
    usable: inviteUsable(code),
    isMember, hasPendingRequest: hasPending,
  });
});

// ─── Join ───────────────────────────────────────────────────────────────────

export const joinGroupByInviteLink = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const data = (request.data ?? {}) as { inviteCode?: unknown };
  if (!isValidInviteCode(data.inviteCode)) throw new HttpsError('invalid-argument', 'invite-invalid');

  await rateLimit('join', uid, 20, 60 * 60 * 1000);   // 20 join attempts / hour

  const db = getFirestore();
  const codeSnap = await db.collection('inviteCodes').doc(data.inviteCode).get();
  if (!codeSnap.exists) throw new HttpsError('not-found', 'invite-not-found');
  const code = codeSnap.data() as { conversationId: string; joinMode: InviteJoinMode; enabled?: boolean; revokedAt?: unknown };
  if (!inviteUsable(code)) throw new HttpsError('failed-precondition', 'invite-disabled');

  const convoRef = db.collection('conversations').doc(code.conversationId);
  const profile = (await db.collection('users').doc(uid).get()).data() as { displayName?: string; photoURL?: string } | undefined;

  const result = await db.runTransaction(async tx => {
    const convoSnap = await tx.get(convoRef);
    if (!convoSnap.exists) throw new HttpsError('not-found', 'group-not-found');
    const convo = convoSnap.data() as { type?: string; participantUids?: string[]; memberCount?: number; externalMemberCount?: number };
    if (convo.type !== 'group') throw new HttpsError('failed-precondition', 'not-a-group');

    const memberSnap = await tx.get(convoRef.collection('members').doc(uid));
    const reqSnap = await tx.get(convoRef.collection('joinRequests').doc(uid));
    const isMember = memberSnap.exists && (memberSnap.get('status') ?? 'active') === 'active';
    const hasPending = reqSnap.exists && reqSnap.get('status') === 'pending';

    const decision = joinDecision(code.joinMode, isMember, hasPending);
    const now = FieldValue.serverTimestamp();

    if (decision === 'already_member') return { status: 'already_member' as const };
    if (decision === 'request_pending') return { status: 'pending' as const };

    if (decision === 'create_request') {
      tx.set(convoRef.collection('joinRequests').doc(uid), {
        requestId: uid, inviteCode: data.inviteCode, requesterUid: uid,
        requesterName: profile?.displayName ?? uid, requesterPhotoURL: profile?.photoURL ?? null,
        status: 'pending', requestedAt: now,
      }, { merge: true });
      return { status: 'pending' as const };
    }

    // join_open — add to the roster.
    const participants = convo.participantUids ?? [];
    if (participants.length + 1 > MAX_GROUP_MEMBERS) throw new HttpsError('failed-precondition', 'too-many-members');
    const next = [...participants, uid];
    tx.update(convoRef, { participantUids: next, memberIds: next, memberCount: next.length, updatedAt: now });
    tx.set(convoRef.collection('members').doc(uid), {
      uid, role: 'member', status: 'active', addedBy: 'invite',
      displayNameSnapshot: profile?.displayName ?? uid, photoURLSnapshot: profile?.photoURL ?? null,
      joinedAt: now, updatedAt: now,
    }, { merge: true });
    tx.set(convoRef.collection('userState').doc(uid), {
      uid, pinned: false, muted: false, archived: false, favorite: false,
      unreadCount: 0, lastReadAt: now, lastMessagePreview: '', lastMessageAt: now, updatedAt: now,
    }, { merge: true });
    return { status: 'joined' as const };
  });

  void writeAuditLog({
    action: `group.invite.${result.status}`, actor: { uid }, target: { type: 'conversation', id: code.conversationId },
    result: 'success', metadata: { joinMode: code.joinMode },
  }).catch(() => {});

  return { status: result.status, conversationId: code.conversationId };
});

// ─── Approve / reject / cancel ──────────────────────────────────────────────

async function addMemberFromRequest(convoRef: FirebaseFirestore.DocumentReference, requesterUid: string) {
  const db = getFirestore();
  const profile = (await db.collection('users').doc(requesterUid).get()).data() as { displayName?: string; photoURL?: string } | undefined;
  await db.runTransaction(async tx => {
    const convoSnap = await tx.get(convoRef);
    if (!convoSnap.exists) throw new HttpsError('not-found', 'group-not-found');
    const convo = convoSnap.data() as { participantUids?: string[] };
    const participants = convo.participantUids ?? [];
    const now = FieldValue.serverTimestamp();
    if (!participants.includes(requesterUid)) {
      if (participants.length + 1 > MAX_GROUP_MEMBERS) throw new HttpsError('failed-precondition', 'too-many-members');
      const next = [...participants, requesterUid];
      tx.update(convoRef, { participantUids: next, memberIds: next, memberCount: next.length, updatedAt: now });
      tx.set(convoRef.collection('members').doc(requesterUid), {
        uid: requesterUid, role: 'member', status: 'active', addedBy: 'invite-approval',
        displayNameSnapshot: profile?.displayName ?? requesterUid, photoURLSnapshot: profile?.photoURL ?? null,
        joinedAt: now, updatedAt: now,
      }, { merge: true });
      tx.set(convoRef.collection('userState').doc(requesterUid), {
        uid: requesterUid, pinned: false, muted: false, archived: false, favorite: false,
        unreadCount: 0, lastReadAt: now, lastMessagePreview: '', lastMessageAt: now, updatedAt: now,
      }, { merge: true });
    }
  });
}

export const approveGroupJoinRequest = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const data = (request.data ?? {}) as { conversationId?: unknown; requestId?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId) throw new HttpsError('invalid-argument', 'conversationId-required');
  if (typeof data.requestId !== 'string' || !data.requestId) throw new HttpsError('invalid-argument', 'requestId-required');

  const { db, convoRef } = await requireGroupAdmin(uid, data.conversationId);
  const reqRef = convoRef.collection('joinRequests').doc(data.requestId);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) throw new HttpsError('not-found', 'request-not-found');
  if (reqSnap.get('status') !== 'pending') throw new HttpsError('failed-precondition', 'request-not-pending');
  const requesterUid = reqSnap.get('requesterUid') as string;

  await addMemberFromRequest(convoRef, requesterUid);
  await reqRef.set({ status: 'approved', decidedByUid: uid, decidedAt: FieldValue.serverTimestamp() }, { merge: true });

  void writeAuditLog({
    action: 'group.join.approved', actor: { uid }, target: { type: 'conversation', id: convoRef.id },
    result: 'success', metadata: { requesterUid },
  }).catch(() => {});
  void db.collection('users').doc(requesterUid).collection('notifications').add({
    type: 'group_join_approved', conversationId: convoRef.id, createdAt: FieldValue.serverTimestamp(), read: false,
  }).catch(() => {});

  return { ok: true };
});

export const rejectGroupJoinRequest = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const data = (request.data ?? {}) as { conversationId?: unknown; requestId?: unknown; reason?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId) throw new HttpsError('invalid-argument', 'conversationId-required');
  if (typeof data.requestId !== 'string' || !data.requestId) throw new HttpsError('invalid-argument', 'requestId-required');

  const { convoRef } = await requireGroupAdmin(uid, data.conversationId);
  const reqRef = convoRef.collection('joinRequests').doc(data.requestId);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) throw new HttpsError('not-found', 'request-not-found');
  if (reqSnap.get('status') !== 'pending') throw new HttpsError('failed-precondition', 'request-not-pending');

  await reqRef.set({
    status: 'rejected', decidedByUid: uid, decidedAt: FieldValue.serverTimestamp(),
    decisionReason: typeof data.reason === 'string' ? data.reason.slice(0, 200) : null,
  }, { merge: true });

  void writeAuditLog({
    action: 'group.join.rejected', actor: { uid }, target: { type: 'conversation', id: convoRef.id },
    result: 'success', metadata: { requesterUid: reqSnap.get('requesterUid') },
  }).catch(() => {});

  return { ok: true };
});

export const cancelMyJoinRequest = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const data = (request.data ?? {}) as { conversationId?: unknown; requestId?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId) throw new HttpsError('invalid-argument', 'conversationId-required');
  const requestId = typeof data.requestId === 'string' && data.requestId ? data.requestId : uid;

  const db = getFirestore();
  const reqRef = db.collection('conversations').doc(data.conversationId).collection('joinRequests').doc(requestId);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) return { ok: true };
  if (reqSnap.get('requesterUid') !== uid) throw new HttpsError('permission-denied', 'not-your-request');
  if (reqSnap.get('status') === 'pending') {
    await reqRef.set({ status: 'cancelled', decidedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  return { ok: true };
});
