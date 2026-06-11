import { describe, it, expect } from 'vitest';
import {
  isStatusAudienceMember, validateTextStatusInput,
  STATUS_BODY_MAX, STATUS_TTL_MS,
} from '../src/statuses/statusLogic';

describe('isStatusAudienceMember', () => {
  it('defaults to all_contacts when audienceType is missing', () => {
    expect(isStatusAudienceMember({}, 'u1')).toBe(true);
  });

  it('all_contacts excludes only the excluded list', () => {
    const s = { audienceType: 'all_contacts' as const, excludedViewerUids: ['u2'] };
    expect(isStatusAudienceMember(s, 'u1')).toBe(true);
    expect(isStatusAudienceMember(s, 'u2')).toBe(false);
  });

  it('contacts_except behaves like all_contacts with exclusions', () => {
    const s = { audienceType: 'contacts_except' as const, excludedViewerUids: ['u3'] };
    expect(isStatusAudienceMember(s, 'u1')).toBe(true);
    expect(isStatusAudienceMember(s, 'u3')).toBe(false);
  });

  it('only_share_with admits only the allowed list', () => {
    const s = { audienceType: 'only_share_with' as const, allowedViewerUids: ['u1'] };
    expect(isStatusAudienceMember(s, 'u1')).toBe(true);
    expect(isStatusAudienceMember(s, 'u2')).toBe(false);
  });

  it('only_share_with with no list admits nobody', () => {
    expect(isStatusAudienceMember({ audienceType: 'only_share_with' }, 'u1')).toBe(false);
  });
});

describe('validateTextStatusInput', () => {
  it('accepts a plain body and applies defaults', () => {
    const out = validateTextStatusInput({ body: '  hello  ' });
    expect(out).toMatchObject({
      body: 'hello',
      audienceType: 'all_contacts',
      allowedViewerUids: [],
      excludedViewerUids: [],
    });
    expect(typeof out === 'object' && /^#[0-9A-F]{6}$/.test(out.backgroundColor)).toBe(true);
  });

  it('rejects missing/empty/too-long bodies', () => {
    expect(validateTextStatusInput({})).toBe('body-required');
    expect(validateTextStatusInput({ body: '   ' })).toBe('body-empty');
    expect(validateTextStatusInput({ body: 'x'.repeat(STATUS_BODY_MAX + 1) })).toBe('body-too-long');
  });

  it('validates and normalises backgroundColor', () => {
    expect(validateTextStatusInput({ body: 'hi', backgroundColor: 'red' })).toBe('background-color-invalid');
    const out = validateTextStatusInput({ body: 'hi', backgroundColor: '#1f7ba8' });
    expect(out).toMatchObject({ backgroundColor: '#1F7BA8' });
  });

  it('rejects unknown audience types', () => {
    expect(validateTextStatusInput({ body: 'hi', audienceType: 'public' })).toBe('audience-invalid');
  });

  it('only_share_with requires a non-empty allowed list and drops exclusions', () => {
    expect(validateTextStatusInput({ body: 'hi', audienceType: 'only_share_with' })).toBe('audience-list-empty');
    const out = validateTextStatusInput({
      body: 'hi', audienceType: 'only_share_with',
      allowedViewerUids: ['a', 'a', 'b'], excludedViewerUids: ['c'],
    });
    expect(out).toMatchObject({ allowedViewerUids: ['a', 'b'], excludedViewerUids: [] });
  });

  it('all_contacts keeps exclusions and drops the allowed list', () => {
    const out = validateTextStatusInput({
      body: 'hi', audienceType: 'all_contacts',
      allowedViewerUids: ['a'], excludedViewerUids: ['c', 'c'],
    });
    expect(out).toMatchObject({ allowedViewerUids: [], excludedViewerUids: ['c'] });
  });
});

describe('constants', () => {
  it('statuses live for 24 hours', () => {
    expect(STATUS_TTL_MS).toBe(86_400_000);
  });
});
