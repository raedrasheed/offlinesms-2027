import { describe, it, expect } from 'vitest';
import {
  isAllowedImageMime,
  isAllowedAudioMime,
  validateMediaMessage,
  normalizeWaveform,
  formatDuration,
  mediaPreviewLabel,
  ATTACHMENT_OPTIONS,
  MAX_MEDIA_BYTES,
  VOICE_MAX_MS,
  WAVEFORM_MAX_BARS,
} from '../src/media/mediaValidation';
import {
  uploadReducer,
  initialUploadState,
  uploadPercent,
} from '../src/media/uploadState';
import { dbToAmplitude } from '../src/media/audio/waveform';

describe('MIME allow-list', () => {
  it('accepts allowed image types and rejects others', () => {
    expect(isAllowedImageMime('image/jpeg')).toBe(true);
    expect(isAllowedImageMime('image/PNG')).toBe(true); // case-insensitive
    expect(isAllowedImageMime('image/webp')).toBe(true);
    expect(isAllowedImageMime('image/gif')).toBe(false);
    expect(isAllowedImageMime('application/x-msdownload')).toBe(false);
  });
  it('accepts allowed audio types and rejects others', () => {
    expect(isAllowedAudioMime('audio/m4a')).toBe(true);
    expect(isAllowedAudioMime('audio/aac')).toBe(true);
    expect(isAllowedAudioMime('audio/mp4')).toBe(true);
    expect(isAllowedAudioMime('video/mp4')).toBe(false);
    expect(isAllowedAudioMime('audio/wav')).toBe(false);
  });
});

describe('validateMediaMessage', () => {
  it('accepts a valid image', () => {
    expect(validateMediaMessage({ mediaType: 'image', mimeType: 'image/jpeg', sizeBytes: 1024 }))
      .toEqual({ ok: true });
  });
  it('rejects an executable masquerading as image', () => {
    expect(validateMediaMessage({ mediaType: 'image', mimeType: 'application/octet-stream', sizeBytes: 1024 }))
      .toEqual({ ok: false, reason: 'mime-not-allowed' });
  });
  it('rejects oversize media', () => {
    expect(validateMediaMessage({ mediaType: 'image', mimeType: 'image/png', sizeBytes: MAX_MEDIA_BYTES + 1 }))
      .toEqual({ ok: false, reason: 'too-large' });
  });
  it('rejects zero-byte media', () => {
    expect(validateMediaMessage({ mediaType: 'image', mimeType: 'image/png', sizeBytes: 0 }).ok).toBe(false);
  });
  it('requires duration for voice', () => {
    expect(validateMediaMessage({ mediaType: 'voice', mimeType: 'audio/m4a', sizeBytes: 2048 }))
      .toEqual({ ok: false, reason: 'duration-missing' });
  });
  it('rejects voice below the minimum and above the maximum', () => {
    expect(validateMediaMessage({ mediaType: 'voice', mimeType: 'audio/m4a', sizeBytes: 2048, durationMs: 500 }))
      .toEqual({ ok: false, reason: 'too-short' });
    expect(validateMediaMessage({ mediaType: 'voice', mimeType: 'audio/m4a', sizeBytes: 2048, durationMs: VOICE_MAX_MS + 1 }))
      .toEqual({ ok: false, reason: 'too-long' });
  });
  it('accepts a valid voice note', () => {
    expect(validateMediaMessage({ mediaType: 'voice', mimeType: 'audio/aac', sizeBytes: 2048, durationMs: 24000 }))
      .toEqual({ ok: true });
  });
});

describe('normalizeWaveform', () => {
  it('returns at most the requested number of bars in [0,1]', () => {
    const samples = Array.from({ length: 500 }, (_, i) => i);
    const bars = normalizeWaveform(samples, WAVEFORM_MAX_BARS);
    expect(bars.length).toBe(WAVEFORM_MAX_BARS);
    expect(Math.max(...bars)).toBeLessThanOrEqual(1);
    expect(Math.min(...bars)).toBeGreaterThanOrEqual(0);
  });
  it('handles empty and all-zero input without throwing', () => {
    expect(normalizeWaveform([], 40)).toEqual([]);
    expect(normalizeWaveform([0, 0, 0], 3)).toEqual([0, 0, 0]);
  });
  it('normalizes the peak to 1', () => {
    const bars = normalizeWaveform([1, 2, 4], 3);
    expect(Math.max(...bars)).toBeCloseTo(1);
  });
});

describe('formatDuration', () => {
  it('formats minutes and zero-padded seconds', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(4000)).toBe('0:04');
    expect(formatDuration(64000)).toBe('1:04');
    expect(formatDuration(600000)).toBe('10:00');
  });
  it('clamps negatives', () => {
    expect(formatDuration(-5000)).toBe('0:00');
  });
});

describe('mediaPreviewLabel & attachment options', () => {
  it('labels previews', () => {
    expect(mediaPreviewLabel('image')).toBe('Photo');
    expect(mediaPreviewLabel('voice')).toBe('Voice message');
  });
  it('enables Photos, Camera and Poll', () => {
    const enabled = ATTACHMENT_OPTIONS.filter(o => o.enabled).map(o => o.key);
    expect(enabled).toEqual(['photos', 'camera', 'poll']);
    expect(ATTACHMENT_OPTIONS).toHaveLength(8);
  });
});

describe('uploadReducer', () => {
  it('walks the happy path pending → uploaded', () => {
    let s = initialUploadState;
    expect(s.phase).toBe('pending');
    s = uploadReducer(s, { type: 'start' });
    expect(s.phase).toBe('creating');
    s = uploadReducer(s, { type: 'created' });
    expect(s.phase).toBe('uploading');
    s = uploadReducer(s, { type: 'progress', value: 0.62 });
    expect(uploadPercent(s)).toBe(62);
    s = uploadReducer(s, { type: 'uploaded' });
    expect(s.phase).toBe('finalizing');
    s = uploadReducer(s, { type: 'finalized' });
    expect(s.phase).toBe('uploaded');
    expect(uploadPercent(s)).toBe(100);
  });
  it('ignores progress unless uploading and clamps to [0,1]', () => {
    const creating = uploadReducer(initialUploadState, { type: 'start' });
    expect(uploadReducer(creating, { type: 'progress', value: 0.5 })).toEqual(creating);
    const uploading = uploadReducer(creating, { type: 'created' });
    expect(uploadReducer(uploading, { type: 'progress', value: 2 }).progress).toBe(1);
  });
  it('fails then resumes on retry', () => {
    let s = uploadReducer(uploadReducer(initialUploadState, { type: 'start' }), { type: 'fail', error: 'net' });
    expect(s.phase).toBe('failed');
    expect(s.error).toBe('net');
    s = uploadReducer(s, { type: 'retry' });
    expect(s.phase).toBe('creating');
  });
});

describe('dbToAmplitude', () => {
  it('maps the metering floor and ceiling into [0,1]', () => {
    expect(dbToAmplitude(0)).toBeCloseTo(1);
    expect(dbToAmplitude(-60)).toBe(0);
    expect(dbToAmplitude(-120)).toBe(0);
    expect(dbToAmplitude(-30)).toBeCloseTo(0.5);
  });
  it('handles missing/invalid input', () => {
    expect(dbToAmplitude(undefined)).toBe(0);
    expect(dbToAmplitude(null)).toBe(0);
    expect(dbToAmplitude(NaN)).toBe(0);
  });
});
