import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPoll, normalizeSelection, applyVote, tally, PollError, POLL_OPTIONS_MAX,
  nextDeviceSeqs, MAX_DEVICE_SEQS,
} from '../src/chats/pollLogic';
import { STICKER_PACKS, findSticker } from '../src/chats/stickerCatalog';
import { messagePreview } from '../src/notifications/notifyLogic';

const code = (f: () => unknown) => { try { f(); return 'ok'; } catch (e) { return e instanceof PollError ? e.code : String(e); } };

describe('buildPoll', () => {
  it('builds options with stable ids, zero counts, single choice by default', () => {
    const p = buildPoll({ question: '  Lunch? ', options: ['Pizza', ' Falafel  ', ''] });
    expect(p.question).toBe('Lunch?');
    expect(p.options).toEqual([{ id: 'o1', text: 'Pizza' }, { id: 'o2', text: 'Falafel' }]);
    expect(p.multiple).toBe(false);
    expect(p.counts).toEqual({ o1: 0, o2: 0 });
    expect(p.voterCount).toBe(0);
    expect(buildPoll({ question: 'q', options: ['a', 'b'], multiple: true }).multiple).toBe(true);
  });
  it('enforces question and option rules', () => {
    expect(code(() => buildPoll({ question: ' ', options: ['a', 'b'] }))).toBe('poll-question-required');
    expect(code(() => buildPoll({ question: 'x'.repeat(301), options: ['a', 'b'] }))).toBe('poll-question-too-long');
    expect(code(() => buildPoll({ question: 'q', options: ['a'] }))).toBe('poll-too-few-options');
    expect(code(() => buildPoll({ question: 'q', options: Array.from({ length: POLL_OPTIONS_MAX + 1 }, (_, i) => `o${i}`) }))).toBe('poll-too-many-options');
    expect(code(() => buildPoll({ question: 'q', options: ['Yes', 'yes'] }))).toBe('poll-duplicate-option');
    expect(code(() => buildPoll({ question: 'q', options: ['a', 'b'.repeat(101)] }))).toBe('poll-option-too-long');
    expect(code(() => buildPoll({ question: 'q', options: 'a,b' }))).toBe('poll-options-required');
  });
  it('accepts Arabic text', () => {
    expect(buildPoll({ question: 'وين نلتقي؟', options: ['رام الله', 'نابلس'] }).options[1].text).toBe('نابلس');
  });
});

describe('votes', () => {
  const single = buildPoll({ question: 'q', options: ['a', 'b', 'c'] });
  const multi = buildPoll({ question: 'q', options: ['a', 'b', 'c'], multiple: true });

  it('single choice: at most one option; [] retracts', () => {
    expect(normalizeSelection(single, ['o2'])).toEqual(['o2']);
    expect(normalizeSelection(single, [])).toEqual([]);
    expect(code(() => normalizeSelection(single, ['o1', 'o2']))).toBe('poll-single-choice');
  });
  it('multiple choice: several options, de-duplicated, option order', () => {
    expect(normalizeSelection(multi, ['o3', 'o1', 'o3'])).toEqual(['o1', 'o3']);
  });
  it('rejects unknown options and malformed input', () => {
    expect(code(() => normalizeSelection(single, ['o9']))).toBe('poll-invalid-option');
    expect(code(() => normalizeSelection(single, 'o1'))).toBe('poll-invalid-selection');
  });
  it('a repeated vote is a no-op (same object) and never double counts', () => {
    const p1 = applyVote(multi, 'u1', ['o1', 'o2']);
    const p2 = applyVote(p1, 'u1', ['o1', 'o2']);
    expect(p2).toBe(p1);
    expect(p2.counts).toEqual({ o1: 1, o2: 1, o3: 0 });
    expect(p2.voterCount).toBe(1);
  });
  it('changing and retracting a vote moves the counts', () => {
    let p = applyVote(single, 'u1', ['o1']);
    p = applyVote(p, 'u2', ['o1']);
    p = applyVote(p, 'u1', ['o3']);
    expect(p.counts).toEqual({ o1: 1, o2: 0, o3: 1 });
    p = applyVote(p, 'u2', []);
    expect(p.counts).toEqual({ o1: 0, o2: 0, o3: 1 });
    expect(p.voterCount).toBe(1);
    expect(p.votes).toEqual({ u1: ['o3'] });
  });
  it('tally ignores options that no longer exist', () => {
    expect(tally([{ id: 'o1', text: 'a' }], { u: ['o1', 'zz'] })).toEqual({ counts: { o1: 1 }, voterCount: 1 });
  });
});

describe('sticker catalog', () => {
  it('matches the app pack manifest exactly', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '../../apps/mobile/assets/stickers/simsim/pack.json'), 'utf8'));
    expect(STICKER_PACKS.simsim.map(s => [s.id, s.alt])).toEqual(manifest.stickers.map((s: any) => [s.id, s.alt]));
  });
  it('only known pack/sticker ids resolve', () => {
    expect(findSticker('simsim', 'hi')).toMatchObject({ packId: 'simsim', id: 'hi', alt: '👋' });
    expect(findSticker('simsim', 'nope')).toBeNull();
    expect(findSticker('__proto__', 'hi')).toBeNull();
    expect(findSticker({}, 'hi')).toBeNull();
  });
});

describe('previews', () => {
  it('sticker and poll previews', () => {
    expect(messagePreview({ type: 'sticker', text: '👋' })).toBe('👋 Sticker');
    expect(messagePreview({ type: 'poll', text: '📊 Lunch?' })).toBe('📊 Lunch?');
  });
});

describe('nextDeviceSeqs', () => {
  it('sets only the voting device and keeps the others', () => {
    expect(nextDeviceSeqs({ a: 5, b: 1_700_000_000_000 }, 'a', 6)).toEqual({ a: 6, b: 1_700_000_000_000 });
    expect(nextDeviceSeqs({}, 'c', 1)).toEqual({ c: 1 });
  });

  it('keeps at most MAX_DEVICE_SEQS, dropping the lowest of the other devices, never the voting one', () => {
    const many = Object.fromEntries(Array.from({ length: MAX_DEVICE_SEQS }, (_, i) => [`d${i}`, i + 10]));
    const next = nextDeviceSeqs(many, 'new', 1);
    expect(Object.keys(next)).toHaveLength(MAX_DEVICE_SEQS);
    expect(next.new).toBe(1);
    expect(next.d0).toBeUndefined();
    expect(next.d1).toBe(11);
  });
});
