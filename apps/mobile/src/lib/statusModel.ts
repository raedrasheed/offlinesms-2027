// Pure status-feed shaping — no Firebase/React-Native imports, so it loads
// cleanly under vitest (the wrappers in `statuses.ts` pull in firebase).

export type StatusFeedItem = {
  statusId:        string;
  authorId:        string;
  authorName:      string;
  authorPhotoURL:  string | null;
  type:            'text';
  body:            string;
  backgroundColor: string | null;
  createdAtMs:     number;
  expiresAtMs:     number;
  viewedByMe:      boolean;
};

export type AuthorStatusGroup = {
  authorId:       string;
  authorName:     string;
  authorPhotoURL: string | null;
  /** Oldest → newest, the order the viewer plays them in. */
  items:          StatusFeedItem[];
  latestAtMs:     number;
  unviewedCount:  number;
  /** Index of the first unviewed item (0 when all viewed) — viewer start point. */
  startIndex:     number;
};

/**
 * Group a flat feed per author for the Status tab. Within a group items run
 * oldest → newest (story order); groups themselves sort newest-activity
 * first. Callers split on `unviewedCount > 0` for the Recent/Viewed sections.
 */
export function groupStatusFeed(items: StatusFeedItem[]): AuthorStatusGroup[] {
  const byAuthor = new Map<string, StatusFeedItem[]>();
  for (const it of items) {
    const list = byAuthor.get(it.authorId);
    if (list) list.push(it);
    else byAuthor.set(it.authorId, [it]);
  }

  const groups: AuthorStatusGroup[] = [];
  for (const list of byAuthor.values()) {
    list.sort((a, b) => a.createdAtMs - b.createdAtMs);
    const newest = list[list.length - 1];
    const firstUnviewed = list.findIndex(x => !x.viewedByMe);
    groups.push({
      authorId:       newest.authorId,
      authorName:     newest.authorName,
      authorPhotoURL: newest.authorPhotoURL,
      items:          list,
      latestAtMs:     newest.createdAtMs,
      unviewedCount:  list.filter(x => !x.viewedByMe).length,
      startIndex:     firstUnviewed === -1 ? 0 : firstUnviewed,
    });
  }

  groups.sort((a, b) => b.latestAtMs - a.latestAtMs);
  return groups;
}
