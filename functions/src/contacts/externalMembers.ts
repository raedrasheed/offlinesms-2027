// Callables: add / remove an external phone contact on a group.
//
// Mirrors addMembers' owner/admin gating. Adds an entry under
// conversations/{id}/externalMembers keyed by phone digits (so a group can't
// hold the same number twice). Does NOT touch the registered `members/{uid}`
// subcollection or participantUids — external members are a parallel roster
// counted via the conversation's `externalMemberCount` field, leaving all
// existing member logic untouched.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';
import { normalizePhoneToE164 } from '../lib/phone';
import { externalMemberId, newExternalMemberDoc, cleanDisplayName } from './contactLogic';
import { findRegisteredUidByPhone } from './createPhoneContact';
import { MAX_GROUP_MEMBERS } from '../chats/createGroup';

async function requireGroupAdmin(uid: string, conversationId: string) {
  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(conversationId);
  const [convoSnap, callerSnap] = await Promise.all([
    convoRef.get(),
    convoRef.collection('members').doc(uid).get(),
  ]);
  if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
  const convo = convoSnap.data() as {
    type?: string; participantUids?: string[];
    memberCount?: number; externalMemberCount?: number;
  };
  if (convo.type !== 'group') throw new HttpsError('failed-precondition', 'not-a-group');
  const role = (callerSnap.data()?.role ?? '') as string;
  const active = (callerSnap.data()?.status ?? 'active') === 'active';
  if (!active || (role !== 'owner' && role !== 'admin')) {
    throw new HttpsError('permission-denied', 'admins-only');
  }
  return { db, convoRef, convo };
}

export const addExternalContactToGroup = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as {
    conversationId?: unknown; contactId?: unknown;
    displayName?: unknown; phoneNumber?: unknown; defaultCountry?: unknown;
  };
  if (typeof data.conversationId !== 'string' || !data.conversationId) {
    throw new HttpsError('invalid-argument', 'conversationId-required');
  }

  const { db, convoRef, convo } = await requireGroupAdmin(uid, data.conversationId);

  // Resolve the contact: either an existing owned phoneContact, or create one
  // inline from name + number.
  let e164: string;
  let displayName: string;
  let ownerContactId: string;

  if (typeof data.contactId === 'string' && data.contactId) {
    const cSnap = await db.collection('phoneContacts').doc(data.contactId).get();
    if (!cSnap.exists) throw new HttpsError('not-found', 'contact-not-found');
    const c = cSnap.data() as { ownerUid?: string; phoneE164?: string; displayName?: string };
    if (c.ownerUid !== uid) throw new HttpsError('permission-denied', 'not-contact-owner');
    e164 = c.phoneE164 ?? '';
    displayName = c.displayName ?? 'Contact';
    ownerContactId = data.contactId;
    if (!e164) throw new HttpsError('failed-precondition', 'contact-missing-phone');
  } else {
    const name = cleanDisplayName(data.displayName);
    if (!name) throw new HttpsError('invalid-argument', 'name-required');
    const defaultCountry = typeof data.defaultCountry === 'string' ? data.defaultCountry : undefined;
    const norm = typeof data.phoneNumber === 'string' ? normalizePhoneToE164(data.phoneNumber, defaultCountry) : null;
    if (!norm) throw new HttpsError('invalid-argument', 'phone-invalid');
    e164 = norm;
    displayName = name;
    ownerContactId = `${uid}_${norm.replace(/\D/g, '')}`;
    // Persist the owner's private contact too (idempotent upsert).
    await db.collection('phoneContacts').doc(ownerContactId).set({
      contactId: ownerContactId, ownerUid: uid,
      organizationId: (request.auth?.token?.organizationId as string | undefined) ?? null,
      displayName, phoneE164: e164, normalizedPhone: e164.replace(/\D/g, ''),
      isRegistered: false, linkedUid: null,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // If this phone already belongs to a registered participant, it's already a
  // real member — don't shadow them with an external entry.
  const linkedUid = await findRegisteredUidByPhone(e164);
  if (linkedUid && (convo.participantUids ?? []).includes(linkedUid)) {
    return { added: 0, alreadyMember: true, contactId: externalMemberId(e164) };
  }

  const emId = externalMemberId(e164);
  const emRef = convoRef.collection('externalMembers').doc(emId);
  const alreadyExternal = (await emRef.get()).exists;
  if (alreadyExternal) return { added: 0, alreadyExternal: true, contactId: emId };

  // Cap: count external members against the same group ceiling as registered.
  const total = (convo.memberCount ?? (convo.participantUids ?? []).length) + (convo.externalMemberCount ?? 0);
  if (total + 1 > MAX_GROUP_MEMBERS) throw new HttpsError('failed-precondition', 'too-many-members');

  const now = FieldValue.serverTimestamp();
  const docData = newExternalMemberDoc({ contactId: ownerContactId, displayName, e164, addedByUid: uid, linkedUid });
  const batch = db.batch();
  batch.set(emRef, { ...docData, addedAt: now, updatedAt: now });
  batch.update(convoRef, { externalMemberCount: FieldValue.increment(1), updatedAt: now });
  await batch.commit();

  void writeAuditLog({
    action: 'group.external.added',
    actor: { uid },
    target: { type: 'conversation', id: convoRef.id },
    result: 'success',
    metadata: { conversationId: convoRef.id, contactId: emId, isRegistered: docData.isRegistered },
  }).catch(() => {});

  return { added: 1, contactId: emId, isRegistered: docData.isRegistered };
});

export const removeExternalContactFromGroup = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { conversationId?: unknown; contactId?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId) {
    throw new HttpsError('invalid-argument', 'conversationId-required');
  }
  if (typeof data.contactId !== 'string' || !data.contactId) {
    throw new HttpsError('invalid-argument', 'contactId-required');
  }

  const { db, convoRef } = await requireGroupAdmin(uid, data.conversationId);
  const emRef = convoRef.collection('externalMembers').doc(data.contactId);
  if (!(await emRef.get()).exists) return { removed: 0 };

  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.delete(emRef);
  batch.update(convoRef, { externalMemberCount: FieldValue.increment(-1), updatedAt: now });
  await batch.commit();

  void writeAuditLog({
    action: 'group.external.removed',
    actor: { uid },
    target: { type: 'conversation', id: convoRef.id },
    result: 'success',
    metadata: { conversationId: convoRef.id, contactId: data.contactId },
  }).catch(() => {});

  return { removed: 1 };
});
