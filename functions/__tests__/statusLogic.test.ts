import { describe, it, expect } from 'vitest';
import {
  isStatusAudienceMember, validateTextStatusInput, validateMediaStatusInput,
  STATUS_BODY_MAX, STATUS_TTL_MS, STATUS_MEDIA_MAX_BYTES, STATUS_VIDEO_MAX_MS,
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

describe('validateMediaStatusInput', () => {
  const base = {
    type: 'image' as const,
    mediaUrl: 'https://firebasestorage.googleapis.com/x/y.jpg',
    storagePath: 'statuses/u1/123-abc.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
  };

  it('accepts a valid image with no caption', () => {
    const out = validateMediaStatusInput(base, 'u1');
    expect(out).toMatchObject({
      type: 'image', body: '', mimeType: 'image/jpeg',
      durationMs: null, audienceType: 'all_contacts',
    });
  });

  it('accepts a valid video with duration and caption', () => {
    const out = validateMediaStatusInput({
      ...base, type: 'video', mimeType: 'video/mp4',
      storagePath: 'statuses/u1/clip.mp4', durationMs: 12_000, body: ' hi ',
    }, 'u1');
    expect(out).toMatchObject({ type: 'video', body: 'hi', durationMs: 12_000 });
  });

  it('rejects unknown types', () => {
    expect(validateMediaStatusInput({ ...base, type: 'gif' }, 'u1')).toBe('type-unsupported');
  });

  it("pins storagePath to the caller's own folder", () => {
    expect(validateMediaStatusInput({ ...base, storagePath: 'statuses/u2/x.jpg' }, 'u1')).toBe('storage-path-invalid');
    expect(validateMediaStatusInput({ ...base, storagePath: 'statuses/u1/../u2/x.jpg' }, 'u1')).toBe('storage-path-invalid');
    expect(validateMediaStatusInput({ ...base, storagePath: 'chatMedia/u1/x.jpg' }, 'u1')).toBe('storage-path-invalid');
  });

  it('requires an https mediaUrl', () => {
    expect(validateMediaStatusInput({ ...base, mediaUrl: 'http://evil/x.jpg' }, 'u1')).toBe('media-url-invalid');
  });

  it('enforces the MIME allow-list per type', () => {
    expect(validateMediaStatusInput({ ...base, mimeType: 'image/gif' }, 'u1')).toBe('mime-not-allowed');
    expect(validateMediaStatusInput({ ...base, type: 'video', mimeType: 'image/jpeg', durationMs: 5000 }, 'u1')).toBe('mime-not-allowed');
  });

  it('enforces the size cap', () => {
    expect(validateMediaStatusInput({ ...base, sizeBytes: 0 }, 'u1')).toBe('size-invalid');
    expect(validateMediaStatusInput({ ...base, sizeBytes: STATUS_MEDIA_MAX_BYTES + 1 }, 'u1')).toBe('size-invalid');
  });

  it('requires and caps the video duration', () => {
    const vid = { ...base, type: 'video' as const, mimeType: 'video/mp4' };
    expect(validateMediaStatusInput(vid, 'u1')).toBe('duration-required');
    expect(validateMediaStatusInput({ ...vid, durationMs: STATUS_VIDEO_MAX_MS + 1 }, 'u1')).toBe('duration-too-long');
  });

  it('caps the caption length', () => {
    expect(validateMediaStatusInput({ ...base, body: 'x'.repeat(STATUS_BODY_MAX + 1) }, 'u1')).toBe('caption-too-long');
  });
});

describe('constants', () => {
  it('statuses live for 24 hours', () => {
    expect(STATUS_TTL_MS).toBe(86_400_000);
  });
});
