import { describe, it, expect } from 'vitest';
import { groupStatusFeed, type StatusFeedItem } from '../src/lib/statusModel';

function item(over: Partial<StatusFeedItem>): StatusFeedItem {
  return {
    statusId: 's', authorId: 'a', authorName: 'A', authorPhotoURL: null,
    type: 'text', body: 'hi', mediaUrl: null, durationMs: null, backgroundColor: '#075E54',
    createdAtMs: 0, expiresAtMs: 9_999_999_999_999, viewedByMe: false,
    ...over,
  };
}

describe('groupStatusFeed', () => {
  it('returns an empty list for an empty feed', () => {
    expect(groupStatusFeed([])).toEqual([]);
  });

  it('groups per author with items in story (oldest → newest) order', () => {
    const groups = groupStatusFeed([
      item({ statusId: 's2', authorId: 'a', createdAtMs: 200 }),
      item({ statusId: 's1', authorId: 'a', createdAtMs: 100 }),
      item({ statusId: 's3', authorId: 'b', authorName: 'B', createdAtMs: 150 }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].authorId).toBe('a'); // newest activity first
    expect(groups[0].items.map(i => i.statusId)).toEqual(['s1', 's2']);
    expect(groups[1].authorId).toBe('b');
  });

  it('counts unviewed items and starts the viewer at the first unviewed', () => {
    const [g] = groupStatusFeed([
      item({ statusId: 's1', createdAtMs: 100, viewedByMe: true }),
      item({ statusId: 's2', createdAtMs: 200, viewedByMe: false }),
      item({ statusId: 's3', createdAtMs: 300, viewedByMe: false }),
    ]);
    expect(g.unviewedCount).toBe(2);
    expect(g.startIndex).toBe(1);
  });

  it('starts fully-viewed groups from the beginning', () => {
    const [g] = groupStatusFeed([
      item({ statusId: 's1', createdAtMs: 100, viewedByMe: true }),
      item({ statusId: 's2', createdAtMs: 200, viewedByMe: true }),
    ]);
    expect(g.unviewedCount).toBe(0);
    expect(g.startIndex).toBe(0);
  });

  it('uses the newest item for the group display name', () => {
    const [g] = groupStatusFeed([
      item({ statusId: 's1', createdAtMs: 100, authorName: 'Old Name' }),
      item({ statusId: 's2', createdAtMs: 200, authorName: 'New Name' }),
    ]);
    expect(g.authorName).toBe('New Name');
    expect(g.latestAtMs).toBe(200);
  });
});
