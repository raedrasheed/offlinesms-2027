import { HttpsError } from 'firebase-functions/v2/https';

export type ClipAudience = 'public' | 'followers' | 'group' | 'private';
export type ClipStatus = 'uploading' | 'processing' | 'failed' | 'pending_review' | 'published' | 'suspended' | 'rejected' | 'removed';
export interface ClipDoc extends Record<string, any> {
  ownerUid: string; status: ClipStatus; audience: ClipAudience; groupId?: string | null;
}
export interface ClipsConfig {
  enabled: boolean; moderationRequired: boolean; maxDurationSeconds: number;
  maxUploadMB: number; maxDailyUploads: number; termsVersion: string; supportEmail: string;
}
export const CLIPS_TERMS_VERSION = 'clips-v1';
export function clipsConfig(raw: Record<string, any> = {}): ClipsConfig {
  const integer = (v: unknown, fallback: number, max: number) => Number.isInteger(v) && (v as number) > 0
    ? Math.min(max, v as number) : fallback;
  return {
    enabled: raw.enabled === true, moderationRequired: raw.moderationRequired !== false,
    maxDurationSeconds: integer(raw.maxDurationSeconds, 60, 180),
    maxUploadMB: integer(raw.maxUploadMB, 80, 200),
    maxDailyUploads: integer(raw.maxDailyUploads, 10, 100),
    termsVersion: typeof raw.termsVersion === 'string' && /^[a-zA-Z0-9._-]{1,50}$/.test(raw.termsVersion)
      ? raw.termsVersion : CLIPS_TERMS_VERSION,
    supportEmail: typeof raw.supportEmail === 'string' ? raw.supportEmail.trim().slice(0, 120) : '',
  };
}
export function clipId(value: unknown, field = 'clipId'): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new HttpsError('invalid-argument', `${field}-invalid`);
  return value;
}
export function cleanClipText(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `${field}-invalid`);
  const text = value.trim();
  if (text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))
    throw new HttpsError('invalid-argument', `${field}-invalid`);
  return text;
}
export function clipHashtags(caption: string): string[] {
  return [...new Set((caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).map(t => t.slice(1).toLocaleLowerCase()))].slice(0, 20);
}
export function validateClipMetadata(input: Record<string, unknown>) {
  const caption = cleanClipText(input.caption ?? '', 2200, 'caption');
  const audience = input.audience;
  if (!['public', 'followers', 'group', 'private'].includes(audience as string))
    throw new HttpsError('invalid-argument', 'audience-invalid');
  const groupId = audience === 'group' ? clipId(input.groupId, 'groupId') : null;
  if (typeof input.allowComments !== 'boolean' || typeof input.allowDownload !== 'boolean')
    throw new HttpsError('invalid-argument', 'clip-options-invalid');
  return { caption, hashtags: clipHashtags(caption), audience: audience as ClipAudience, groupId,
    allowComments: input.allowComments, allowDownload: input.allowDownload };
}
export function millis(value: unknown): number {
  return typeof (value as any)?.toMillis === 'function' ? (value as any).toMillis() : 0;
}
export function pageLimit(value: unknown, defaultValue = 20): number {
  return typeof value === 'number' && Number.isInteger(value) ? Math.min(30, Math.max(1, value)) : defaultValue;
}
export function encodeClipCursor(createdAt: unknown, id: string): string {
  const timestamp = createdAt as any;
  return Buffer.from(JSON.stringify([timestamp?.seconds ?? 0, timestamp?.nanoseconds ?? 0, id])).toString('base64url');
}
export function decodeClipCursor(value: unknown): [number, number, string] | null {
  if (value == null || value === '') return null;
  try {
    if (typeof value !== 'string' || value.length > 512) throw new Error();
    const v = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(v) || v.length !== 3 || !Number.isInteger(v[0]) || !Number.isInteger(v[1])
        || v[0] < 0 || v[0] > 253402300799 || v[1] < 0 || v[1] >= 1e9) throw new Error();
    return [v[0], v[1], clipId(v[2], 'cursor')];
  } catch { throw new HttpsError('invalid-argument', 'cursor-invalid'); }
}
