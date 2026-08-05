// Pure @mention helpers — no React/native imports so they unit-test in node and
// are reused by the composer (detect/insert), send path (resolve indices), and
// bubble renderer (segment split).
//
// A mention "token" in the text is "@" + the member's display name. While
// typing, the active query is the run of non-whitespace characters between an
// "@" (at start or after whitespace) and the cursor. Matching is
// space/case-insensitive so a single-word query like "@raed" still matches a
// multi-word display name ("Raed S. Rasheed").

import type { Mention } from './conversations';

export type MentionCandidate = {
  uid: string;
  displayName: string;
  username?: string | null;
  phone?: string | null;
};

const MAX_QUERY = 32;

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

/**
 * If the cursor sits inside an "@query" token, return the query (text after the
 * "@", excluding it) and the index of the "@". Otherwise null.
 */
export function detectMentionQuery(
  text: string,
  cursor: number,
): { query: string; start: number } | null {
  if (cursor < 0 || cursor > text.length) return null;
  let i = cursor - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '@') {
      const prev = i > 0 ? text[i - 1] : '';
      if (i === 0 || /\s/.test(prev)) {
        const query = text.slice(i + 1, cursor);
        if (query.length > MAX_QUERY) return null;
        return { query, start: i };
      }
      return null; // "@" glued to a word (e.g. an email) — not a mention
    }
    if (/\s/.test(ch)) return null; // whitespace before reaching "@" ⇒ no token
    i -= 1;
  }
  return null;
}

/** Filter members by display name, username, or phone. Name/username use
 *  prefix matching (on the whole normalized value or any word), so "@raed"
 *  matches "Raed S. Rasheed" and "@rasheed" matches it too, but "@ra" does NOT
 *  match "Qaddoura". Phone matches by digit substring once ≥3 digits are typed.
 *  An empty query returns the full list (shown right after typing "@"). */
export function filterMembers(
  members: MentionCandidate[],
  query: string,
  limit = 8,
): MentionCandidate[] {
  const q = norm(query);
  if (q.length === 0) return members.slice(0, limit);
  const digits = query.replace(/\D/g, '');

  const matchesName = (name: string) => {
    if (norm(name).startsWith(q)) return true;
    return name.split(/\s+/).some(word => norm(word).startsWith(q));
  };

  const matches = members.filter(m =>
    matchesName(m.displayName)
    || (m.username ? norm(m.username).startsWith(q) : false)
    || (digits.length >= 3 && m.phone ? m.phone.replace(/\D/g, '').includes(digits) : false),
  );
  return matches.slice(0, limit);
}

/**
 * Replace the active "@query" (at `start`..`cursor`) with "@DisplayName " and
 * return the new text plus the cursor position after the inserted token.
 */
export function insertMention(
  text: string,
  start: number,
  cursor: number,
  member: MentionCandidate,
): { text: string; cursor: number; token: string } {
  const token = `@${member.displayName}`;
  const before = text.slice(0, start);
  const after = text.slice(cursor);
  // Ensure a single trailing space so the next word doesn't glue to the mention.
  const sep = after.startsWith(' ') ? '' : ' ';
  const newText = `${before}${token}${sep}${after}`;
  return { text: newText, cursor: before.length + token.length + sep.length, token };
}

/**
 * Resolve concrete mention spans from the final text and the set of members the
 * user picked. We re-scan the text for each picked member's "@DisplayName" token
 * so indices stay correct regardless of edits made after insertion. Spans never
 * overlap; a member mentioned twice yields two spans.
 */
export function resolveMentions(
  text: string,
  selected: Array<{ userId: string; displayName: string }>,
): Mention[] {
  const out: Mention[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) => taken.some(([ts, te]) => s < te && e > ts);

  // Longer names first so "@Raed Rasheed" wins over "@Raed" at the same spot.
  const ordered = [...selected].sort((a, b) => b.displayName.length - a.displayName.length);
  for (const m of ordered) {
    const token = `@${m.displayName}`;
    let from = 0;
    for (;;) {
      const idx = text.indexOf(token, from);
      if (idx === -1) break;
      const end = idx + token.length;
      // The token must be a standalone mention: preceded by start/whitespace and
      // followed by end/whitespace/punctuation (not another word char).
      const prevOk = idx === 0 || /\s/.test(text[idx - 1]);
      const nextCh = text[end] ?? '';
      const nextOk = nextCh === '' || !/[\w@]/.test(nextCh);
      if (prevOk && nextOk && !overlaps(idx, end)) {
        out.push({ userId: m.userId, displayName: m.displayName, startIndex: idx, endIndex: end });
        taken.push([idx, end]);
      }
      from = idx + token.length;
    }
  }
  return out.sort((a, b) => a.startIndex - b.startIndex);
}

export type TextSegment =
  | { type: 'text'; text: string }
  | { type: 'mention'; text: string; userId: string };

/** Split text into plain + mention segments for highlighted rendering. */
export function renderMentionSegments(text: string, mentions?: Mention[] | null): TextSegment[] {
  if (!mentions || mentions.length === 0) return [{ type: 'text', text }];
  const valid = mentions
    .filter(m => m.startIndex >= 0 && m.endIndex <= text.length && m.startIndex < m.endIndex)
    .sort((a, b) => a.startIndex - b.startIndex);
  const segs: TextSegment[] = [];
  let cursor = 0;
  for (const m of valid) {
    if (m.startIndex < cursor) continue; // overlap guard
    if (m.startIndex > cursor) segs.push({ type: 'text', text: text.slice(cursor, m.startIndex) });
    segs.push({ type: 'mention', text: text.slice(m.startIndex, m.endIndex), userId: m.userId });
    cursor = m.endIndex;
  }
  if (cursor < text.length) segs.push({ type: 'text', text: text.slice(cursor) });
  return segs;
}
