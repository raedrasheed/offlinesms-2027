// Sticker + poll message payloads on the client — pure, unit-tested.
// The server is authoritative (functions/src/chats/pollLogic.ts); the client
// mirrors its rules so the UI can enforce them before sending and show an
// optimistic vote immediately (corrected by the next snapshot).

export interface StickerRef { packId: string; stickerId: string; alt: string }

export interface PollOption { id: string; text: string }
export interface PollData {
  question: string;
  options: PollOption[];
  multiple: boolean;
  closed: boolean;
  votes: Record<string, string[]>;
  counts: Record<string, number>;
  voterCount: number;
}

export const POLL_QUESTION_MAX = 300;
export const POLL_OPTION_MAX = 100;
export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 12;

/** Payload stored in messages.payload_json for a given message type. */
export function payloadFromRemote(type: string | undefined, m: Record<string, any>): string | null {
  if (type === 'sticker' && m.sticker) {
    const s = m.sticker;
    return JSON.stringify({ packId: String(s.packId ?? ''), stickerId: String(s.stickerId ?? ''), alt: String(s.alt ?? '') });
  }
  if (type === 'poll' && m.poll) return JSON.stringify(sanitizePoll(m.poll));
  return null;
}

export function sanitizePoll(p: any): PollData {
  const options: PollOption[] = Array.isArray(p?.options)
    ? p.options.filter((o: any) => o && typeof o.id === 'string').map((o: any) => ({ id: o.id, text: String(o.text ?? '') }))
    : [];
  const votes: Record<string, string[]> = {};
  if (p?.votes && typeof p.votes === 'object') {
    for (const [uid, sel] of Object.entries(p.votes)) if (Array.isArray(sel)) votes[uid] = (sel as unknown[]).filter((x): x is string => typeof x === 'string');
  }
  return {
    question: String(p?.question ?? ''), options, multiple: p?.multiple === true, closed: p?.closed === true,
    votes, ...tally(options, votes),
  };
}

export function parseSticker(json: string | null | undefined): StickerRef | null {
  if (!json) return null;
  try { const s = JSON.parse(json); return s && typeof s.packId === 'string' && typeof s.stickerId === 'string' ? s : null; } catch { return null; }
}

export function parsePoll(json: string | null | undefined): PollData | null {
  if (!json) return null;
  try { return sanitizePoll(JSON.parse(json)); } catch { return null; }
}

export function tally(options: PollOption[], votes: Record<string, string[]>): { counts: Record<string, number>; voterCount: number } {
  const counts: Record<string, number> = Object.fromEntries(options.map(o => [o.id, 0]));
  let voterCount = 0;
  for (const sel of Object.values(votes)) {
    if (!sel?.length) continue;
    voterCount++;
    for (const id of sel) if (id in counts) counts[id]++;
  }
  return { counts, voterCount };
}

/** Tapping an option: the next selection under the poll's mode. */
export function toggleSelection(poll: Pick<PollData, 'multiple' | 'options'>, current: readonly string[], optionId: string): string[] {
  const has = current.includes(optionId);
  const next = poll.multiple
    ? (has ? current.filter(x => x !== optionId) : [...current, optionId])
    : (has ? [] : [optionId]);
  return poll.options.map(o => o.id).filter(id => next.includes(id));
}

/** Optimistic local application of my vote. */
export function applyLocalVote(poll: PollData, uid: string, selection: string[]): PollData {
  const votes = { ...poll.votes };
  if (selection.length) votes[uid] = selection; else delete votes[uid];
  return { ...poll, votes, ...tally(poll.options, votes) };
}

export interface PollView {
  options: Array<PollOption & { count: number; percent: number; mine: boolean }>;
  voterCount: number;
  mine: string[];
}

export function pollView(poll: PollData, me: string | undefined): PollView {
  const mine = (me && poll.votes[me]) || [];
  const total = poll.voterCount;
  return {
    voterCount: total,
    mine,
    options: poll.options.map(o => {
      const count = poll.counts[o.id] ?? 0;
      return { ...o, count, percent: total ? Math.round((count / total) * 100) : 0, mine: mine.includes(o.id) };
    }),
  };
}

export type PollDraftError = 'question' | 'tooFew' | 'tooMany' | 'duplicate' | 'tooLong' | null;

/** Validate the composer's poll form (same rules as the server). */
export function validatePollDraft(question: string, options: string[]): PollDraftError {
  const q = question.trim();
  if (!q) return 'question';
  if (q.length > POLL_QUESTION_MAX) return 'tooLong';
  const opts = options.map(o => o.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (opts.some(o => o.length > POLL_OPTION_MAX)) return 'tooLong';
  if (opts.length < POLL_OPTIONS_MIN) return 'tooFew';
  if (opts.length > POLL_OPTIONS_MAX) return 'tooMany';
  if (new Set(opts.map(o => o.toLocaleLowerCase())).size !== opts.length) return 'duplicate';
  return null;
}
