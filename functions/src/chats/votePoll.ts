// Callables: votePoll / closePoll.
//
// votePoll({ conversationId, messageId, optionIds, seq, deviceId })
//   • caller must be a participant (and an ACTIVE member of a group); a
//     disabled conversation or a blocked direct chat refuses votes;
//   • single-choice polls accept at most one option; [] retracts the vote;
//   • one Firestore transaction reads the poll + the caller's server-only voter
//     doc and rewrites the voter's entry; counts are recomputed from all votes,
//     so a retried / duplicated request can never be counted twice;
//   • `seq` (a counter, strictly increasing per device) makes a late retry of
//     an OLDER vote from the SAME device a no-op instead of overwriting a newer
//     one. Watermarks are kept per `deviceId`: devices' clocks and counters are
//     never compared, so between two devices of one account the vote that
//     arrives last wins. Requests without `deviceId` (test builds before this
//     change) share one watermark, which also takes over a voter doc's older
//     single `seq`.
//   Result: { ok, unchanged?, stale?, counts, voterCount, selection }.
//
// closePoll({ conversationId, messageId }) — the poll's creator ends voting.
//
// The voter doc lives at conversations/{c}/messages/{m}/pollVoters/{uid}; the
// rules give clients no access to it (messages' subcollections default-deny).

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, type Transaction } from 'firebase-admin/firestore';
import { assertDirectNotBlocked } from './blockGuard';
import { applyVote, nextDeviceSeqs, normalizeSelection, PollError, type PollDoc } from './pollLogic';

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
/** Watermark key for requests that carry no deviceId. */
const NO_DEVICE = '_';
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const votePoll = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const data = (request.data ?? {}) as Record<string, unknown>;
  const { conversationId, messageId } = ids(data);
  const seq = typeof data.seq === 'number' && Number.isFinite(data.seq) ? data.seq : 0;
  const device = typeof data.deviceId === 'string' && DEVICE_ID_RE.test(data.deviceId) ? data.deviceId : NO_DEVICE;

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
    if (poll.closed) throw new HttpsError('failed-precondition', 'poll-closed');

    let selection: string[];
    try { selection = normalizeSelection(poll, data.optionIds); }
    catch (e) { throw new HttpsError('invalid-argument', e instanceof PollError ? e.code : 'poll-invalid-selection'); }

    const voter = voterSnap.data() ?? {};
    const seqs: Record<string, number> = { ...((voter.seqs as Record<string, number> | undefined) ?? {}) };
    if (typeof voter.seq === 'number' && seqs[NO_DEVICE] === undefined) seqs[NO_DEVICE] = voter.seq;
    const lastSeq = seqs[device] ?? -Infinity;
    if (seq > 0 && seq <= lastSeq) {
      // A retry of an older (or the same) vote from this device that already
      // landed: keep the newer one.
      const current = poll.votes?.[uid] ?? [];
      return { unchanged: true, stale: seq < lastSeq, poll, selection: current };
    }
    const next = applyVote(poll, uid, selection);
    const unchanged = next === poll;
    if (!unchanged) {
      tx.update(msgRef, { poll: next, updatedAt: FieldValue.serverTimestamp() });
    }
    // A request without seq (older client) never moves a watermark, so it
    // can't make a later sequenced vote look stale.
    tx.set(voterRef, {
      optionIds: selection,
      seqs: seq > 0 ? nextDeviceSeqs(seqs, device, seq) : seqs,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { unchanged, stale: false, poll: next, selection };
  }, { maxAttempts: VOTE_TX_ATTEMPTS });

  return {
    ok: true,
    unchanged: result.unchanged,
    stale: result.stale,
    selection: result.selection,
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
    if (msg.poll.closed) return;
    tx.update(msgRef, { 'poll.closed': true, 'poll.closedAt': FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});
