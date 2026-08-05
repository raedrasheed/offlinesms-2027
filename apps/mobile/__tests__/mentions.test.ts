import { describe, it, expect } from 'vitest';
import {
  detectMentionQuery, filterMembers, insertMention, resolveMentions, renderMentionSegments,
  type MentionCandidate,
} from '../src/lib/mentions';

const MEMBERS: MentionCandidate[] = [
  { uid: 'u1', displayName: 'Raed S. Rasheed', username: 'raed', phone: '+970599111222' },
  { uid: 'u2', displayName: 'Ahmed Qaddoura', username: 'ahmed', phone: '+970599883344' },
  { uid: 'u3', displayName: 'Iyad', username: null, phone: null },
];

describe('detectMentionQuery', () => {
  it('detects an @ token at the cursor', () => {
    expect(detectMentionQuery('hi @ra', 6)).toEqual({ query: 'ra', start: 3 });
  });
  it('detects @ at the start of the text', () => {
    expect(detectMentionQuery('@ra', 3)).toEqual({ query: 'ra', start: 0 });
  });
  it('returns the empty query right after typing @', () => {
    expect(detectMentionQuery('hi @', 4)).toEqual({ query: '', start: 3 });
  });
  it('ignores @ glued to a word (emails)', () => {
    expect(detectMentionQuery('mail me@x', 9)).toBeNull();
  });
  it('returns null when whitespace separates the cursor from @', () => {
    expect(detectMentionQuery('@ra ', 4)).toBeNull();
  });
});

describe('filterMembers', () => {
  it('matches by display name, space/case-insensitive', () => {
    expect(filterMembers(MEMBERS, 'raed').map(m => m.uid)).toEqual(['u1']);
    expect(filterMembers(MEMBERS, 'RA').map(m => m.uid)).toEqual(['u1']);
  });
  it('matches a single-word query against a multi-word name', () => {
    expect(filterMembers(MEMBERS, 'rasheed').map(m => m.uid)).toEqual(['u1']);
  });
  it('matches by username', () => {
    expect(filterMembers(MEMBERS, 'ahmed').map(m => m.uid)).toEqual(['u2']);
  });
  it('matches by phone digits', () => {
    expect(filterMembers(MEMBERS, '883344').map(m => m.uid)).toEqual(['u2']);
  });
  it('returns all members for an empty query', () => {
    expect(filterMembers(MEMBERS, '').length).toBe(3);
  });
});

describe('insertMention', () => {
  it('replaces the @query with @DisplayName + a trailing space', () => {
    const r = insertMention('hi @ra', 3, 6, MEMBERS[0]);
    expect(r.text).toBe('hi @Raed S. Rasheed ');
    expect(r.cursor).toBe('hi @Raed S. Rasheed '.length);
  });
  it('does not double a following space', () => {
    const r = insertMention('hi @ra there', 3, 6, MEMBERS[0]);
    expect(r.text).toBe('hi @Raed S. Rasheed there');
  });
});

describe('resolveMentions', () => {
  it('finds the span of a mention in the final text', () => {
    const text = 'hi @Raed S. Rasheed how are you';
    const out = resolveMentions(text, [{ userId: 'u1', displayName: 'Raed S. Rasheed' }]);
    expect(out).toEqual([{ userId: 'u1', displayName: 'Raed S. Rasheed', startIndex: 3, endIndex: 19 }]);
    expect(text.slice(out[0].startIndex, out[0].endIndex)).toBe('@Raed S. Rasheed');
  });
  it('supports multiple mentions', () => {
    const text = '@Iyad and @Ahmed Qaddoura';
    const out = resolveMentions(text, [
      { userId: 'u3', displayName: 'Iyad' },
      { userId: 'u2', displayName: 'Ahmed Qaddoura' },
    ]);
    expect(out.map(m => m.userId)).toEqual(['u3', 'u2']);
  });
  it('drops a picked member whose token was edited out', () => {
    const out = resolveMentions('hello world', [{ userId: 'u1', displayName: 'Raed S. Rasheed' }]);
    expect(out).toEqual([]);
  });
});

describe('renderMentionSegments', () => {
  it('splits text into plain + mention segments', () => {
    const text = 'hi @Iyad!';
    const segs = renderMentionSegments(text, [
      { userId: 'u3', displayName: 'Iyad', startIndex: 3, endIndex: 8 },
    ]);
    expect(segs).toEqual([
      { type: 'text', text: 'hi ' },
      { type: 'mention', text: '@Iyad', userId: 'u3' },
      { type: 'text', text: '!' },
    ]);
  });
  it('returns a single text segment when there are no mentions', () => {
    expect(renderMentionSegments('plain', null)).toEqual([{ type: 'text', text: 'plain' }]);
  });
});
