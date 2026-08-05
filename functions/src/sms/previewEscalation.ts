// Callable: previewSmsEscalation
//
// Read-only preview that mirrors the audience + eligibility logic of
// escalateSms without mutating anything. Returns masked phones plus the
// caller's wallet snapshot so the UI can show cost + remaining balance
// before the user confirms.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import {
  AudienceInput, canonicalAudience, classifyRecipients, filterByAudience, findAlreadySentUids,
  loadExternalEligibles,
  COST_PER_SMS, MAX_RECIPIENTS_PER_BATCH,
} from './recipients';

export const previewSmsEscalation = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as {
    conversationId?: unknown;
    messageId?:      unknown;
    audience?:       unknown;
  };
  if (typeof data.conversationId !== 'string' || !data.conversationId)
    throw new HttpsError('invalid-argument', 'conversationId-required');
  if (typeof data.messageId !== 'string' || !data.messageId)
    throw new HttpsError('invalid-argument', 'messageId-required');
  if (typeof data.audience !== 'string')
    throw new HttpsError('invalid-argument', 'audience-required');

  const valid = ['everyone', 'unread_only', 'undelivered_only', 'unread', 'undelivered'];
  if (!valid.includes(data.audience)) {
    throw new HttpsError('invalid-argument', 'audience-invalid');
  }
  const audience = canonicalAudience(data.audience as AudienceInput);

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(data.conversationId);
  const msgRef = convoRef.collection('messages').doc(data.messageId);

  const [convoSnap, msgSnap] = await Promise.all([convoRef.get(), msgRef.get()]);
  if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
  if (!msgSnap.exists)   throw new HttpsError('not-found', 'message-not-found');

  const convo = convoSnap.data() as { participantUids?: string[]; memberIds?: string[]; type?: string };
  const participants = convo.participantUids ?? convo.memberIds ?? [];
  if (!participants.includes(uid)) {
    throw new HttpsError('permission-denied', 'not-a-participant');
  }

  const msg = msgSnap.data() as { senderUid?: string; senderId?: string; deletedForEveryone?: boolean };
  const senderUid = msg.senderUid ?? msg.senderId;
  if (senderUid !== uid && convo.type !== 'group') {
    throw new HttpsError('permission-denied', 'not-message-sender');
  }
  if (senderUid !== uid && convo.type === 'group') {
    const m = await convoRef.collection('members').doc(uid).get();
    const role = (m.data()?.role ?? '') as string;
    if (role !== 'owner' && role !== 'admin') {
      throw new HttpsError('permission-denied', 'admins-only');
    }
  }
  if (msg.deletedForEveryone) throw new HttpsError('failed-precondition', 'message-deleted');

  const receiptsSnap = await msgRef.collection('receipts').get();
  const receiptsByUid = new Map<string, { status?: string }>();
  for (const r of receiptsSnap.docs) {
    receiptsByUid.set(r.id, { status: (r.data() as { status?: string }).status });
  }
  const { candidates } = filterByAudience(audience, participants, senderUid ?? uid, receiptsByUid);
  const alreadySent = await findAlreadySentUids(db, uid, data.messageId);
  const { eligible, excluded } = await classifyRecipients(db, candidates, alreadySent);

  // Phase 25 — include the group's external phone contacts in the preview so
  // their count + masked-phone row shows up in the Recipients step and the
  // Points/Audience math matches what escalateSms will actually charge.
  //
  // We intentionally do NOT gate this on `convo.type === 'group'`: a 1:1 chat
  // simply has no externalMembers subcollection (loadExternalEligibles returns
  // []), while gating on an exact type string silently drops external
  // recipients if a group's `type` field is ever missing or legacy.
  {
    const existingPhones = new Set(eligible.map(e => e.phone));
    const externalEligible = await loadExternalEligibles(db, data.conversationId, participants, existingPhones);
    for (const e of externalEligible) eligible.push(e);
  }

  const wallet = await db.collection('wallets').doc(uid).get();
  const balance  = (wallet.data()?.balance  as number) ?? 0;
  const reserved = (wallet.data()?.reserved as number) ?? 0;

  const pointsCost = eligible.length * COST_PER_SMS;

  return {
    audience,
    eligibleRecipients: eligible.map(e => ({
      uid:              e.uid,
      displayName:      e.displayName,
      maskedPhone:      e.maskedPhone,
      appReceiptStatus: e.appReceiptStatus,
    })),
    excludedRecipients: excluded.map(e => ({
      uid:              e.uid,
      displayName:      e.displayName,
      appReceiptStatus: e.appReceiptStatus,
      skipReason:       e.skipReason,
    })),
    eligibleCount: eligible.length,
    excludedCount: excluded.length,
    pointsCost,
    costPerSms:    COST_PER_SMS,
    walletBalance: balance,
    walletReserved: reserved,
    audienceCap:   MAX_RECIPIENTS_PER_BATCH,
    exceedsCap:    eligible.length > MAX_RECIPIENTS_PER_BATCH,
  };
});
