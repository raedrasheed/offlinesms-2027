// Polls — pure rules shared by sendTextMessage (create) and votePoll/closePoll.
// No Firestore here, so every rule is unit-tested in isolation.
//
// Stored on the message doc (type 'poll'):
//   poll: {
//     question, options: [{ id, text }], multiple, closed, closedAt,
//     votes:  { [uid]: optionId[] }   ← one entry per voter (source of truth)
//     counts: { [optionId]: number }  ← ALWAYS recomputed from `votes`
//     voterCount: number
//   }
// Counts are derived, never incremented, so a retried or duplicated vote can't
// be counted twice; the voter's per-device sequence (server-only doc) rejects a
// stale retry that arrives after a newer vote from the same device.

export const POLL_QUESTION_MAX = 300;
export const POLL_OPTION_MAX = 100;
export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 12;

export interface PollOption { id: string; text: string }
export interface PollDoc {
  question: string;
  options: PollOption[];
  multiple: boolean;
  closed: boolean;
  closedAt?: unknown;
  votes: Record<string, string[]>;
  counts: Record<string, number>;
  voterCount: number;
}

export class PollError extends Error {
  constructor(public code: string) { super(code); }
}

const clean = (s: unknown, max: number) =>
  typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** Validate a client poll definition and build the initial stored poll. */
export function buildPoll(input: unknown): PollDoc {
  const p = (input ?? {}) as { question?: unknown; options?: unknown; multiple?: unknown };
  const question = clean(p.question, POLL_QUESTION_MAX + 1);
  if (!question) throw new PollError('poll-question-required');
  if (question.length > POLL_QUESTION_MAX) throw new PollError('poll-question-too-long');
  if (!Array.isArray(p.options)) throw new PollError('poll-options-required');
  const texts = p.options.map(o => clean(typeof o === 'string' ? o : (o as any)?.text, POLL_OPTION_MAX + 1)).filter(Boolean);
  if (texts.some(t => t.length > POLL_OPTION_MAX)) throw new PollError('poll-option-too-long');
  if (texts.length < POLL_OPTIONS_MIN) throw new PollError('poll-too-few-options');
  if (texts.length > POLL_OPTIONS_MAX) throw new PollError('poll-too-many-options');
  const seen = new Set<string>();
  for (const t of texts) {
    const k = t.toLocaleLowerCase();
    if (seen.has(k)) throw new PollError('poll-duplicate-option');
    seen.add(k);
  }
  const options = texts.map((text, i) => ({ id: `o${i + 1}`, text }));
  return {
    question, options, multiple: p.multiple === true, closed: false,
    votes: {}, counts: Object.fromEntries(options.map(o => [o.id, 0])), voterCount: 0,
  };
}

/** Validate a selection against the poll's mode. [] retracts the vote. */
export function normalizeSelection(poll: Pick<PollDoc, 'options' | 'multiple'>, optionIds: unknown): string[] {
  if (!Array.isArray(optionIds)) throw new PollError('poll-invalid-selection');
  const valid = new Set(poll.options.map(o => o.id));
  const ids = [...new Set(optionIds)];
  if (ids.some(id => typeof id !== 'string' || !valid.has(id))) throw new PollError('poll-invalid-option');
  if (!poll.multiple && ids.length > 1) throw new PollError('poll-single-choice');
  // Stable order (option order) so equal selections compare equal.
  return poll.options.map(o => o.id).filter(id => ids.includes(id));
}

export function sameSelection(a: readonly string[] | undefined, b: readonly string[]): boolean {
  const x = a ?? [];
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/** Counts per option + number of voters, derived from the votes map. */
export function tally(options: PollOption[], votes: Record<string, string[]>): { counts: Record<string, number>; voterCount: number } {
  const counts: Record<string, number> = Object.fromEntries(options.map(o => [o.id, 0]));
  let voterCount = 0;
  for (const sel of Object.values(votes)) {
    if (!sel || sel.length === 0) continue;
    voterCount++;
    for (const id of sel) if (id in counts) counts[id]++;
  }
  return { counts, voterCount };
}

/** Apply one voter's selection; returns the new poll (unchanged → same object). */
export function applyVote(poll: PollDoc, uid: string, selection: string[]): PollDoc {
  if (sameSelection(poll.votes?.[uid], selection)) return poll;
  const votes = { ...(poll.votes ?? {}) };
  if (selection.length === 0) delete votes[uid];
  else votes[uid] = selection;
  return { ...poll, votes, ...tally(poll.options, votes) };
}

/** Short, content-light preview text (chat list / push / older clients). */
export function pollFallbackText(question: string): string {
  return `📊 ${question}`;
}

/** Per-device vote watermarks kept on one voter doc; the lowest go first. */
export const MAX_DEVICE_SEQS = 20;

/** The voter's watermarks with `device` set to `seq`, at most MAX_DEVICE_SEQS kept. */
export function nextDeviceSeqs(seqs: Record<string, number>, device: string, seq: number): Record<string, number> {
  const next = { ...seqs, [device]: seq };
  const others = Object.keys(next).filter(k => k !== device).sort((a, b) => next[a] - next[b]);
  while (others.length >= MAX_DEVICE_SEQS) delete next[others.shift()!];
  return next;
}
