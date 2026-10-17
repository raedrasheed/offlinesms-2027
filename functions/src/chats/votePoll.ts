// Callables: votePoll / closePoll.
//
// votePoll({ conversationId, messageId, optionIds, seq })
//   • caller must be a participant (and an ACTIVE member of a group); a
//     disabled conversation or a blocked direct chat refuses votes;
//   • single-choice polls accept at most one option; [] retracts the vote;
//   • a transaction updates the caller's private ballot and poll totals; public
//     polls derive totals from their votes map, anonymous polls use the private
//     previous selection as a delta and never publish voter identifiers;
//   • `seq` (client time of the vote, strictly increasing per voter) makes a
//     late retry of an OLDER vote a no-op instead of overwriting a newer one.
//   Result: { ok, unchanged?, stale?, counts, voterCount, selection, seq }.
//
// closePoll({ conversationId, messageId }) — the poll's creator ends voting.
//
// The voter doc lives at conversations/{c}/messages/{m}/pollVoters/{uid}; the
// rules allow only its owner to get an anonymous ballot, never to list them.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, type Transaction } from 'firebase-admin/firestore';
import { assertDirectNotBlocked } from './blockGuard';
import { applyVote, applyAnonymousVote, normalizeSelection, PollError, type PollDoc } from './pollLogic';

type Convo = { type?: string; participantUids?: string[]; memberIds?: string[]; status?: string };

async function assertMember(tx: Transaction, convoRef: FirebaseFirestore.DocumentReference, uid: string): Promise<Convo> {
  const convoSnap = await tx.get(convoRef);
  if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
  const convo = convoSnap.data() as Convo;
  const participants = convo.participantUids ?? convo.memberIds ?? [];
  if (!participants.includes(uid)) throw new HttpsError('permission-denied', 'not-a-participant');
  if (convo.status === 'disabled') throw new HttpsError('failed-precondition', 'conversation-disabled');
  if (convo.type === 'group') {
    const member = await tx.get(convoRef.collection('members').doc(uid));
    if (!member.exists || ((member.data()?.status as string | undefined) ?? 'active') !== 'active') {
      throw new HttpsError('permission-denied', 'not-an-active-member');
    }
  }
  return convo;
}

function ids(data: Record<string, unknown>) {
  if (typeof data.conversationId !== 'string' || !data.conversationId) throw new HttpsError('invalid-argument', 'conversationId-required');
  if (typeof data.messageId !== 'string' || !data.messageId) throw new HttpsError('invalid-argument', 'messageId-required');
  return { conversationId: data.conversationId, messageId: data.messageId };
}

/** Transaction attempts for one vote (Firestore's default is 5). */
const VOTE_TX_ATTEMPTS = 15;

export const votePoll = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const data = (request.data ?? {}) as Record<string, unknown>;
  // Bind queued votes to the account that chose them, including an auth switch
  // while the callable SDK is obtaining its token. Legacy clients omit this.
  if (data.voterUid !== undefined && data.voterUid !== uid) throw new HttpsError('permission-denied', 'account-changed');
  const { conversationId, messageId } = ids(data);
  const seq = typeof data.seq === 'number' && Number.isFinite(data.seq) ? data.seq : 0;

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(conversationId);
  const msgRef = convoRef.collection('messages').doc(messageId);
  const voterRef = msgRef.collection('pollVoters').doc(uid);

  // Direct chats: a vote is refused when either side has blocked the other
  // (checked before the transaction; membership is re-checked inside it).
  const pre = await convoRef.get();
  if (pre.exists) await assertDirectNotBlocked(db, pre.data() as Convo, uid);

  // Every vote on a poll writes the same message document, so a busy group
  // poll contends for one lock. Firestore aborts a waiting transaction
  // ("Transaction lock timeout"); the SDK retries it with backoff, and its
  // default of 5 attempts was not enough for 50 simultaneous votes.
  const result = await db.runTransaction(async (tx) => {
    await assertMember(tx, convoRef, uid);
    const [msgSnap, voterSnap] = await Promise.all([tx.get(msgRef), tx.get(voterRef)]);
    if (!msgSnap.exists) throw new HttpsError('not-found', 'message-not-found');
    const msg = msgSnap.data() as { type?: string; poll?: PollDoc; deletedForEveryone?: boolean };
    if (msg.type !== 'poll' || !msg.poll || msg.deletedForEveryone) throw new HttpsError('failed-precondition', 'not-a-poll');
    const poll = msg.poll;
    if (poll.anonymous ? poll.votingClosed !== false : poll.closed) throw new HttpsError('failed-precondition', 'poll-closed');

    let selection: string[];
    try { selection = normalizeSelection(poll, data.optionIds); }
    catch (e) { throw new HttpsError('invalid-argument', e instanceof PollError ? e.code : 'poll-invalid-selection'); }

    const lastSeq = (voterSnap.data()?.seq as number | undefined) ?? -Infinity;
    const previous = poll.anonymous ? (voterSnap.data()?.optionIds ?? []) as string[] : poll.votes?.[uid] ?? [];
    if (seq > 0 && seq <= lastSeq) {
      // A retry of an older (or the same) vote that already landed: keep the newer one.
      return { unchanged: true, stale: seq < lastSeq, poll, selection: previous, seq: lastSeq };
    }
    const next = poll.anonymous ? applyAnonymousVote(poll, previous, selection) : applyVote(poll, uid, selection);
    const unchanged = next === poll;
    if (!unchanged) {
      tx.update(msgRef, { poll: next, updatedAt: FieldValue.serverTimestamp() });
    }
    // Anonymous ballots need a monotonic watermark even for unsequenced calls
    // so a delayed reply cannot overwrite a newer private cache entry.
    const acceptedSeq = seq > 0 ? seq : poll.anonymous ? Math.max(Date.now(), lastSeq + 1) : Math.max(lastSeq, 0);
    tx.set(voterRef, { optionIds: selection, seq: acceptedSeq, updatedAt: FieldValue.serverTimestamp() });
    return { unchanged, stale: false, poll: next, selection, seq: acceptedSeq };
  }, { maxAttempts: VOTE_TX_ATTEMPTS });

  return {
    ok: true,
    unchanged: result.unchanged,
    stale: result.stale,
    selection: result.selection,
    seq: result.seq,
    counts: result.poll.counts,
    voterCount: result.poll.voterCount,
  };
});

export const closePoll = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const { conversationId, messageId } = ids((request.data ?? {}) as Record<string, unknown>);
  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(conversationId);
  const msgRef = convoRef.collection('messages').doc(messageId);
  await db.runTransaction(async (tx) => {
    await assertMember(tx, convoRef, uid);
    const snap = await tx.get(msgRef);
    if (!snap.exists) throw new HttpsError('not-found', 'message-not-found');
    const msg = snap.data() as { type?: string; poll?: PollDoc; senderUid?: string; senderId?: string };
    if (msg.type !== 'poll' || !msg.poll) throw new HttpsError('failed-precondition', 'not-a-poll');
    if ((msg.senderUid ?? msg.senderId) !== uid) throw new HttpsError('permission-denied', 'only-creator-can-close');
    if (msg.poll.anonymous ? msg.poll.votingClosed !== false : msg.poll.closed) return;
    tx.update(msgRef, { 'poll.closed': true, ...(msg.poll.anonymous ? { 'poll.votingClosed': true } : {}),
      'poll.closedAt': FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});
