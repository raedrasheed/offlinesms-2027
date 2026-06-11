// Pure helpers for leaving a group. No Firestore here so the
// ownership-succession logic is unit-testable in isolation.

export interface SuccessorCandidate {
  uid:        string;
  role:       string;   // 'owner' | 'admin' | 'member' (owner excluded by caller)
  joinedAtMs: number;   // 0 when unknown — sorts as most senior
}

/**
 * Pick who inherits ownership when the owner leaves a group that still has
 * other active members. Preference order:
 *   1. Admins before plain members.
 *   2. Within a tier, the most senior member (earliest joinedAt).
 *   3. uid as a final, deterministic tie-breaker.
 *
 * Returns the chosen uid, or null when there are no candidates (the owner is
 * the last member out, so the conversation is disabled instead).
 */
export function chooseOwnershipSuccessor(candidates: SuccessorCandidate[]): string | null {
  if (candidates.length === 0) return null;

  const rank = (role: string) => (role === 'admin' ? 0 : 1);

  const sorted = [...candidates].sort((a, b) => {
    const byRole = rank(a.role) - rank(b.role);
    if (byRole !== 0) return byRole;
    if (a.joinedAtMs !== b.joinedAtMs) return a.joinedAtMs - b.joinedAtMs;
    return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
  });

  return sorted[0].uid;
}
