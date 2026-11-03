import { describe, expect, it } from 'vitest';
import { clipUploadErrorMessage, sanitizeClipUploadError } from '../src/lib/clipUploadErrors';

const en = (english: string) => english;
const ar = (_english: string, arabic: string) => arabic;

describe('clip upload failure messages', () => {
  it('preserves the specific callable reason instead of its general Firebase code', () => {
    const failure = { code: 'functions/resource-exhausted', message: 'clip-upload-daily-limit', clipUploadStage: 'initialize' };
    expect(sanitizeClipUploadError(failure)).toEqual({ code: 'clip-upload-daily-limit', stage: 'initialize' });
    expect(clipUploadErrorMessage(failure, en)).toContain('today’s upload limit');
    expect(clipUploadErrorMessage(failure, ar)).toContain('الحد اليومي');
  });
  it.each([
    ['storage/canceled', 'Upload stopped.'],
    ['clip-session-changed', 'Your account changed.'],
    ['storage/unauthenticated', 'Sign in again'],
    ['storage/unauthorized', 'The upload was denied.'],
    ['clip-file-missing', 'file is no longer available'],
    ['clip-file-too-large', 'upload size limit'],
    ['clip-file-invalid', 'MP4, MOV or WebM'],
    ['clips-rate-limited', 'try again in a minute'],
    ['clips-terms-required', 'community terms changed'],
    ['clips-terms-version-changed', 'community terms changed'],
    ['clips-disabled', 'Publishing is currently disabled'],
    ['storage/object-not-found', 'upload session expired'],
  ])('explains %s with an actionable message', (code, expected) => {
    expect(clipUploadErrorMessage({ code }, en)).toContain(expected);
    expect(clipUploadErrorMessage({ code }, ar)).not.toContain(expected);
  });
  it('distinguishes a lost publishing response from an incomplete byte upload', () => {
    const failure = { code: 'functions/deadline-exceeded' };
    expect(clipUploadErrorMessage(failure, en, 'upload')).toContain('Check your connection');
    expect(clipUploadErrorMessage(failure, en, 'publish')).toContain('Video upload completed, but publication was not confirmed');
    expect(clipUploadErrorMessage({ ...failure, clipUploadStage: 'publish' }, en, 'initialize')).toContain('check its status');
    expect(clipUploadErrorMessage({ message: 'clip-upload-incomplete', clipUploadStage: 'publish' }, en)).toContain('upload is incomplete');
  });
  it('never retains or displays arbitrary native errors, bearer tokens, paths or session URLs', () => {
    const failure = { code: 'http/secret-token', message: 'https://host/upload?token=secret-token storage/canceled /private/video.mp4', clipUploadStage: 'token=secret-token' };
    expect(sanitizeClipUploadError(failure)).toEqual({ code: 'clip-upload-failed' });
    const message = clipUploadErrorMessage(failure, en, 'initialize');
    expect(message).toContain('Reference: CLIP-INIT');
    expect(message).not.toMatch(/secret-token|https:|private|storage\/canceled/);
    expect(clipUploadErrorMessage(null, en, 'publish')).toContain('publication was not confirmed');
  });
});
