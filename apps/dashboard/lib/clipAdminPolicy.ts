export const CLIP_STATUSES = ['uploading', 'processing', 'failed', 'pending_review', 'published', 'suspended', 'rejected', 'removed'] as const;
export type ClipStatus = typeof CLIP_STATUSES[number];
export type ClipModerationAction = 'approve' | 'reject' | 'remove' | 'suspend' | 'restore';
export type ClipAdminConfig = {
  enabled: boolean; moderationRequired: boolean; maxDurationSeconds: number;
  maxUploadMB: number; maxDailyUploads: number; termsVersion: string; supportEmail: string;
};
export const CLIP_CONFIG_DEFAULTS: ClipAdminConfig = {
  enabled: false, moderationRequired: true, maxDurationSeconds: 60,
  maxUploadMB: 80, maxDailyUploads: 10, termsVersion: 'clips-v1', supportEmail: '',
};

export function isClipDocumentId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    && value !== '.' && value !== '..' && !/[/\u0000-\u001f]/.test(value);
}

/** Keep aligned with functions/src/clips/access.ts. A stale admin boolean must
 * never elevate an organization or support role into global media access. */
export function hasPlatformClipClaims(claims: Record<string, unknown>): boolean {
  return claims.role === 'super_admin' || claims.role === 'legacy_admin'
    || (claims.admin === true && !claims.role && !claims.organizationId && (!Array.isArray(claims.roles) || claims.roles.length === 0));
}

export function readClipAdminConfig(data: Record<string, unknown> = {}, supportEmail = ''): ClipAdminConfig {
  const number = (key: keyof ClipAdminConfig, min: number, max: number) => {
    const v = data[key];
    return typeof v === 'number' && Number.isInteger(v) && v >= min ? Math.min(v, max) : CLIP_CONFIG_DEFAULTS[key] as number;
  };
  return {
    enabled: data.enabled === true, moderationRequired: data.moderationRequired !== false,
    maxDurationSeconds: number('maxDurationSeconds', 1, 180),
    maxUploadMB: number('maxUploadMB', 1, 200), maxDailyUploads: number('maxDailyUploads', 1, 100),
    termsVersion: typeof data.termsVersion === 'string' && /^[a-zA-Z0-9._-]{1,50}$/.test(data.termsVersion) ? data.termsVersion : 'clips-v1',
    supportEmail: typeof data.supportEmail === 'string' && data.supportEmail.trim() ? data.supportEmail.trim() : supportEmail,
  };
}

/** Strictly accept the form fields that operators can change. Missing checkbox
 * values are rejected, not interpreted as false after a stale form submission. */
export function parseClipAdminConfig(data: FormData): ClipAdminConfig {
  const boolean = (key: string) => {
    const v = data.get(key);
    if (v !== 'true' && v !== 'false') throw new Error('Reload the settings form before saving.');
    return v === 'true';
  };
  const integer = (key: string, min: number, max: number) => {
    const raw = data.get(key);
    const v = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(v) || v < min || v > max) throw new Error(`${key} must be between ${min} and ${max}.`);
    return v;
  };
  const termsVersion = String(data.get('termsVersion') ?? '').trim();
  if (!/^[a-zA-Z0-9._-]{1,50}$/.test(termsVersion)) throw new Error('Use a terms version of 1–50 letters, numbers, dots, hyphens or underscores.');
  const supportEmail = String(data.get('supportEmail') ?? '').trim();
  if (supportEmail && (supportEmail.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail))) throw new Error('Enter a valid support email.');
  const enabled = boolean('enabled');
  if (enabled && !supportEmail) throw new Error('Provide a support email before enabling Clips.');
  return { enabled, moderationRequired: boolean('moderationRequired'),
    maxDurationSeconds: integer('maxDurationSeconds', 1, 180),
    maxUploadMB: integer('maxUploadMB', 1, 200), maxDailyUploads: integer('maxDailyUploads', 1, 100),
    termsVersion, supportEmail };
}

export function moderationTarget(status: string, action: ClipModerationAction): ClipStatus {
  if (action === 'approve' && (status === 'pending_review' || status === 'published')) return 'published';
  if (action === 'reject' && (status === 'pending_review' || status === 'rejected')) return 'rejected';
  if (action === 'remove' && ['pending_review', 'published', 'suspended', 'rejected', 'failed', 'removed'].includes(status)) return 'removed';
  if (action === 'suspend' && (status === 'published' || status === 'suspended')) return 'suspended';
  if (action === 'restore' && (status === 'suspended' || status === 'published')) return 'published';
  throw new Error('This clip has changed or is not ready for that moderation action. Reload it.');
}

export function validateClipMediaPath(ownerUid: string, clipId: string, path: unknown): path is string {
  return isClipDocumentId(ownerUid) && isClipDocumentId(clipId) && typeof path === 'string'
    && [`clipMedia/${ownerUid}/${clipId}/standard.mp4`, `clipMedia/${ownerUid}/${clipId}/dataSaver.mp4`, `clipMedia/${ownerUid}/${clipId}/cover.jpg`].includes(path);
}

export function clipVersion(snapshot: { updateTime?: { seconds: number; nanoseconds: number } }): string {
  return snapshot.updateTime ? `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}` : '';
}

export function adminReason(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 3 || value.trim().length > 500) throw new Error('Enter a reason between 3 and 500 characters.');
  return value.trim();
}
