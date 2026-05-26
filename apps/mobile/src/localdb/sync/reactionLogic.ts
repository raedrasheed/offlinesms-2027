// Phase 22D — pure reaction-toggle logic, mirroring the server reactToMessage
// rule (one emoji per user per message: toggling the same emoji clears it,
// choosing a different emoji replaces it). Pure → unit-testable in node and
// reused for the optimistic local update before the outbox round-trips.

export type ReactionMap = Record<string, string[]>;

export function toggleReaction(
  reactions: ReactionMap | null | undefined,
  emoji: string,
  uid: string,
): ReactionMap | null {
  const next: ReactionMap = {};
  let toggledOff = false;
  for (const [e, uids] of Object.entries(reactions ?? {})) {
    const cleaned = (uids ?? []).filter(u => u !== uid);
    if (cleaned.length > 0) next[e] = cleaned;
    if (e === emoji && (uids ?? []).includes(uid)) toggledOff = true;
  }
  if (!toggledOff) next[emoji] = [...(next[emoji] ?? []), uid];
  return Object.keys(next).length === 0 ? null : next;
}
