// Polls + stickers through the REAL callables against the Firestore emulator:
// creation rules, membership / permissions, single vs multiple choice,
// idempotent retries (no double counting), stale retries, concurrent voting,
// closing, delete-for-everyone, and the sticker catalog gate.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/auditLog', () => ({ writeAuditLog: vi.fn(async () => {}) }));

import { db, resetEmulators, req, expectHttps } from './harness';
import { sendTextMessage, sendPollMessage } from '../src/chats/sendTextMessage';
import { votePoll, closePoll } from '../src/chats/votePoll';
import { deleteMessage } from '../src/chats/deleteMessage';

const G = 'grp-poll';
const D = 'dm-poll';
const OWNER = 'u_owner';
const members = Array.from({ length: 25 }, (_, i) => `u_m${i}`);

async function seedGroup(extra: Record<string, unknown> = {}) {
  const all = [OWNER, ...members];
  await db().collection('conversations').doc(G).set({ type: 'group', participantUids: all, memberIds: all, status: 'active', ...extra });
  const batch = db().batch();
  for (const uid of all) {
    batch.set(db().collection('conversations').doc(G).collection('members').doc(uid), {
      role: uid === OWNER ? 'owner' : 'member', status: 'active', displayNameSnapshot: uid,
    });
  }
  await batch.commit();
}

const send = (uid: string, data: Record<string, unknown>, cid = G) =>
  sendTextMessage.run(req(uid, { conversationId: cid, ...data })) as Promise<{ messageId: string; idempotent: boolean }>;
const vote = (uid: string, messageId: string, optionIds: unknown, seq?: number, cid = G) =>
  votePoll.run(req(uid, { conversationId: cid, messageId, optionIds, ...(seq != null ? { seq } : {}) })) as
    Promise<{ ok: true; unchanged: boolean; stale: boolean; counts: Record<string, number>; voterCount: number; selection: string[] }>;
const pollOf = async (messageId: string, cid = G) => (await db().doc(`conversations/${cid}/messages/${messageId}`).get()).data()!.poll;

async function createPoll(multiple = false, by = OWNER) {
  const r = await send(by, { kind: 'poll', poll: { question: 'Where do we meet?', options: ['Ramallah', 'Nablus', 'Jenin'], multiple } });
  return r.messageId;
}

beforeEach(async () => {
  await resetEmulators();
  await seedGroup();
});

describe('poll creation', () => {
  it('stores the poll with a text fallback for older clients', async () => {
    const id = await createPoll();
    const m = (await db().doc(`conversations/${G}/messages/${id}`).get()).data()!;
    expect(m.type).toBe('poll');
    expect(m.text).toBe('📊 Where do we meet?');
    expect(m.poll).toMatchObject({ question: 'Where do we meet?', multiple: false, closed: false, voterCount: 0, counts: { o1: 0, o2: 0, o3: 0 } });
  });

  it('enforces the rules server-side', async () => {
    await expectHttps(send(OWNER, { kind: 'poll', poll: { question: 'q', options: ['only one'] } }), 'invalid-argument', 'poll-too-few-options');
    await expectHttps(send(OWNER, { kind: 'poll', poll: { question: 'q', options: ['a', 'A'] } }), 'invalid-argument', 'poll-duplicate-option');
    await expectHttps(send('u_outsider', { kind: 'poll', poll: { question: 'q', options: ['a', 'b'] } }), 'permission-denied', 'not-a-participant');
  });

  it('follows the group send policy (admins-only)', async () => {
    await seedGroup({ settings: { onlyAdminsCanSend: true } });
    await expectHttps(send(members[0], { kind: 'poll', poll: { question: 'q', options: ['a', 'b'] } }), 'permission-denied', 'admins-only');
    expect(await createPoll()).toBeTruthy();
  });

  it('a retried create with the same localId returns the same poll', async () => {
    const a = await send(OWNER, { kind: 'poll', localId: 'local_p1', poll: { question: 'q', options: ['a', 'b'] } });
    const b = await send(OWNER, { kind: 'poll', localId: 'local_p1', poll: { question: 'q', options: ['a', 'b'] } });
    expect(b).toEqual({ messageId: a.messageId, idempotent: true });
  });
});

describe('voting', () => {
  it('single choice: one option per voter; changing moves the vote', async () => {
    const id = await createPoll(false);
    await expectHttps(vote(members[0], id, ['o1', 'o2']), 'invalid-argument', 'poll-single-choice');
    await vote(members[0], id, ['o1'], 1);
    const r = await vote(members[0], id, ['o2'], 2);
    expect(r.counts).toEqual({ o1: 0, o2: 1, o3: 0 });
    expect(r.voterCount).toBe(1);
  });

  it('multiple choice: several options per voter, each counted once', async () => {
    const id = await createPoll(true);
    await vote(members[0], id, ['o1', 'o3'], 1);
    const r = await vote(members[1], id, ['o3'], 1);
    expect(r.counts).toEqual({ o1: 1, o2: 0, o3: 2 });
    expect(r.voterCount).toBe(2);
  });

  it('a retried request (same seq) is not counted twice', async () => {
    const id = await createPoll(true);
    const first = await vote(members[0], id, ['o1', 'o2'], 100);
    const retry = await vote(members[0], id, ['o1', 'o2'], 100);
    expect(first.unchanged).toBe(false);
    expect(retry.unchanged).toBe(true);
    expect((await pollOf(id)).counts).toEqual({ o1: 1, o2: 1, o3: 0 });
  });

  it('a late retry of an OLDER vote does not overwrite the newer one', async () => {
    const id = await createPoll(false);
    await vote(members[0], id, ['o1'], 100);
    await vote(members[0], id, ['o2'], 200);
    const late = await vote(members[0], id, ['o1'], 100);
    expect(late).toMatchObject({ unchanged: true, stale: true, selection: ['o2'] });
    expect((await pollOf(id)).counts).toEqual({ o1: 0, o2: 1, o3: 0 });
  });

  it('retracting removes the voter', async () => {
    const id = await createPoll(false);
    await vote(members[0], id, ['o1'], 1);
    const r = await vote(members[0], id, [], 2);
    expect(r.voterCount).toBe(0);
    expect((await pollOf(id)).votes).toEqual({});
  });

  // 50 simultaneous transactions on one message document. The emulator settles
  // the lock conflicts by lock timeouts, and votePoll retries each aborted vote
  // with the SDK's growing backoff (up to 15 attempts, about 350 s of base delay
  // in all). Measured on Node 22: the last vote lands after 8 to 61 s, none
  // rejected. The clock must not decide this test: a vote that runs out of
  // attempts is rejected, and that fails the first assertion.
  const CONTENDED_VOTES_TIMEOUT_MS = 600_000;

  it('concurrent votes from 25 members (with duplicate retries) are all counted exactly once', async () => {
    const id = await createPoll(true);
    const calls = members.flatMap((uid, i) => {
      const sel = i % 3 === 0 ? ['o1'] : i % 3 === 1 ? ['o2', 'o3'] : ['o1', 'o3'];
      // Every member's request is sent twice at once (a retry racing the original).
      return [vote(uid, id, sel, 10), vote(uid, id, sel, 10)];
    });
    const settled = await Promise.allSettled(calls);
    expect(settled.filter(s => s.status === 'rejected')).toHaveLength(0);
    const p = await pollOf(id);
    const n1 = members.filter((_, i) => i % 3 === 0).length;
    const n2 = members.filter((_, i) => i % 3 === 1).length;
    const n3 = members.filter((_, i) => i % 3 === 2).length;
    expect(p.voterCount).toBe(members.length);
    expect(p.counts).toEqual({ o1: n1 + n3, o2: n2, o3: n2 + n3 });
    expect(Object.keys(p.votes)).toHaveLength(members.length);
  }, CONTENDED_VOTES_TIMEOUT_MS);

  it('respects membership: outsiders and removed members cannot vote', async () => {
    const id = await createPoll();
    await expectHttps(vote('u_outsider', id, ['o1']), 'permission-denied', 'not-a-participant');
    await db().doc(`conversations/${G}/members/${members[3]}`).update({ status: 'removed' });
    await expectHttps(vote(members[3], id, ['o1']), 'permission-denied', 'not-an-active-member');
  });

  it('refuses unknown options, non-polls and disabled conversations', async () => {
    const id = await createPoll();
    await expectHttps(vote(members[0], id, ['o9']), 'invalid-argument', 'poll-invalid-option');
    const text = await send(OWNER, { text: 'hello' });
    await expectHttps(vote(members[0], text.messageId, ['o1']), 'failed-precondition', 'not-a-poll');
    await db().doc(`conversations/${G}`).update({ status: 'disabled' });
    await expectHttps(vote(members[0], id, ['o1']), 'failed-precondition', 'conversation-disabled');
  });

  it('only the creator can close; a closed poll refuses votes but keeps results', async () => {
    const id = await createPoll();
    await vote(members[0], id, ['o2'], 1);
    await expectHttps(closePoll.run(req(members[0], { conversationId: G, messageId: id })), 'permission-denied', 'only-creator-can-close');
    await closePoll.run(req(OWNER, { conversationId: G, messageId: id }));
    await expectHttps(vote(members[1], id, ['o1']), 'failed-precondition', 'poll-closed');
    expect((await pollOf(id))).toMatchObject({ closed: true, counts: { o2: 1 } });
  });

  it('delete-for-everyone removes the poll and its votes from the message', async () => {
    const id = await createPoll();
    await vote(members[0], id, ['o1'], 1);
    await deleteMessage.run(req(OWNER, { conversationId: G, messageId: id, mode: 'for_everyone' }));
    const m = (await db().doc(`conversations/${G}/messages/${id}`).get()).data()!;
    expect(m.deletedForEveryone).toBe(true);
    expect(m.poll).toBeUndefined();
    await expectHttps(vote(members[1], id, ['o1']), 'failed-precondition', 'not-a-poll');
  });
});

describe('stickers', () => {
  it('stores only catalog stickers, with the emoji as fallback text', async () => {
    const { messageId } = await send(members[0], { kind: 'sticker', sticker: { packId: 'simsim', stickerId: 'hi' } });
    const m = (await db().doc(`conversations/${G}/messages/${messageId}`).get()).data()!;
    expect(m).toMatchObject({ type: 'sticker', text: '👋', sticker: { packId: 'simsim', stickerId: 'hi', alt: '👋' } });
    await expectHttps(send(members[0], { kind: 'sticker', sticker: { packId: 'simsim', stickerId: 'evil', url: 'https://x' } }), 'invalid-argument', 'sticker-unknown');
  });

  it('honours direct-chat blocks', async () => {
    await db().collection('conversations').doc(D).set({ type: 'direct', participantUids: ['u_a', 'u_b'], status: 'active' });
    expect((await send('u_a', { kind: 'sticker', sticker: { packId: 'simsim', stickerId: 'love' } }, D)).messageId).toBeTruthy();
    const p = await send('u_a', { kind: 'poll', poll: { question: 'q', options: ['a', 'b'] } }, D);
    await db().doc('users/u_b/blockedUsers/u_a').set({ at: 1 });
    await expectHttps(send('u_a', { kind: 'sticker', sticker: { packId: 'simsim', stickerId: 'love' } }, D), 'permission-denied', 'blocked-by-recipient');
    await expectHttps(vote('u_a', p.messageId, ['o1'], 1, D), 'permission-denied', 'blocked-by-recipient');
    await expectHttps(vote('u_b', p.messageId, ['o1'], 1, D), 'permission-denied', 'recipient-blocked');
  });
});


describe('anonymous polls', () => {
  const createAnonymous = async (multiple = false) => (await sendPollMessage.run(req(OWNER, {
    conversationId: G, kind: 'poll', poll: { question: 'Private?', options: ['Yes', 'No', 'Maybe'], multiple, anonymous: true },
  })) as { messageId: string }).messageId;

  it('uses an explicit capable endpoint and rejects privacy typos', async () => {
    await expectHttps(send(OWNER, { kind: 'poll', poll: { question: 'q', options: ['a', 'b'], anonymous: true } }), 'failed-precondition', 'use-sendPollMessage');
    await expectHttps(send(OWNER, { kind: 'poll', poll: { question: 'q', options: ['a', 'b'], anonymous: 'true' } }), 'invalid-argument', 'poll-invalid-privacy');
    await expectHttps(sendPollMessage.run(req(OWNER, { conversationId: G, text: 'hello' })), 'invalid-argument', 'poll-required');
    const id = await createAnonymous();
    expect(await pollOf(id)).toMatchObject({ anonymous: true, closed: true, votingClosed: false, votes: {}, voterCount: 0 });
    expect(await pollOf(await createPoll())).toMatchObject({ anonymous: false });
  });
  it('shares only totals; duplicate/stale changes return only the caller’s own selection', async () => {
    const id = await createAnonymous();
    await vote(members[0], id, ['o1'], 100);
    await vote(members[1], id, ['o3'], 100);
    await vote(members[0], id, ['o2'], 200);
    const late = await vote(members[0], id, ['o1'], 100);
    expect(late).toMatchObject({ unchanged: true, stale: true, selection: ['o2'], seq: 200 });
    expect(late).not.toHaveProperty('votes');
    expect(await pollOf(id)).toMatchObject({ anonymous: true, closed: true, votingClosed: false, votes: {}, counts: { o1: 0, o2: 1, o3: 1 }, voterCount: 2 });
    const shared = JSON.stringify(await pollOf(id));
    for (const uid of members) expect(shared).not.toContain(uid);
    expect((await db().doc(`conversations/${G}/messages/${id}/pollVoters/${members[0]}`).get()).data()).toMatchObject({ optionIds: ['o2'], seq: 200 });
    await vote(members[0], id, [], 300);
    await vote(members[0], id, [], 300);
    expect(await pollOf(id)).toMatchObject({ votes: {}, counts: { o1: 0, o2: 0, o3: 1 }, voterCount: 1 });
  });
  it('counts concurrent anonymous multi-choice ballots and retries once per voter', async () => {
    const id = await createAnonymous(true);
    const voters = members.slice(0, 8);
    const results = await Promise.allSettled(voters.flatMap(uid => [vote(uid, id, ['o1', 'o2'], 100), vote(uid, id, ['o1', 'o2'], 100)]));
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(0);
    expect(await pollOf(id)).toMatchObject({ votes: {}, counts: { o1: 8, o2: 8, o3: 0 }, voterCount: 8 });
    await vote(voters[0], id, ['o2', 'o3'], 200);
    expect(await pollOf(id)).toMatchObject({ counts: { o1: 7, o2: 8, o3: 1 }, voterCount: 8 });
  }, 600_000);
  it('refuses a queued ballot if authentication switched accounts during dispatch', async () => {
    const id = await createAnonymous();
    await expectHttps(votePoll.run(req(members[1], { conversationId: G, messageId: id,
      optionIds: ['o1'], seq: 100, voterUid: members[0],
    })), 'permission-denied', 'account-changed');
    expect(await pollOf(id)).toMatchObject({ votes: {}, voterCount: 0 });
  });
  it('keeps membership, selection and closing gates for anonymous polls', async () => {
    const id = await createAnonymous();
    await expectHttps(vote(members[0], id, ['o1', 'o2']), 'invalid-argument', 'poll-single-choice');
    await expectHttps(vote('outsider', id, ['o1']), 'permission-denied', 'not-a-participant');
    await vote(members[0], id, ['o1'], 1);
    await closePoll.run(req(OWNER, { conversationId: G, messageId: id }));
    await expectHttps(vote(members[0], id, ['o2'], 2), 'failed-precondition', 'poll-closed');
    expect(await pollOf(id)).toMatchObject({ anonymous: true, closed: true, votingClosed: true, votes: {}, voterCount: 1 });
  });
});
