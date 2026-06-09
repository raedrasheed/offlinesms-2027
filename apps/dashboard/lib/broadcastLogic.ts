// Pure helpers for admin broadcast notifications (Phase 28). No Firestore /
// FCM here so validation, audience-scope guards, payload building, and batch
// chunking are unit-testable in isolation.

export type BroadcastAudienceType =
  | 'all_users'
  | 'organization'
  | 'selected_users'
  | 'single_user'
  | 'role';

export type BroadcastActionType =
  | 'open_app'
  | 'open_chat'
  | 'open_group'
  | 'open_campaign'
  | 'open_url'
  | 'none';

export interface BroadcastAudienceConfig {
  type: BroadcastAudienceType;
  organizationIds?: string[];
  userIds?: string[];
  role?: string;
}

export interface BroadcastInput {
  title: string;
  body: string;
  imageUrl?: string;
  actionType: BroadcastActionType;
  actionTarget?: string;
  audience: BroadcastAudienceConfig;
}

export const TITLE_MAX = 80;
export const BODY_MAX  = 240;
/** Per-FCM-message batch size (Admin SDK sendAll-style chunks). 500 is well
 *  under the documented 500 cap and keeps each batch quick. */
export const SEND_BATCH_SIZE = 500;

const ROLES = new Set(['super_admin', 'organization_admin', 'organization_member', 'support_agent']);

const ACTION_TYPES: ReadonlySet<BroadcastActionType> = new Set([
  'open_app', 'open_chat', 'open_group', 'open_campaign', 'open_url', 'none',
]);

export type ValidationError =
  | 'title-required' | 'title-too-long'
  | 'body-required'  | 'body-too-long'
  | 'image-not-https'
  | 'action-invalid'
  | 'action-target-required'
  | 'action-target-not-https'
  | 'audience-invalid'
  | 'audience-missing-org'
  | 'audience-missing-users'
  | 'audience-missing-user'
  | 'audience-missing-role'
  | 'audience-role-invalid';

/** Validate an incoming broadcast. Returns null when valid, else an error code. */
export function validateBroadcast(input: BroadcastInput): ValidationError | null {
  const title = (input.title ?? '').trim();
  if (!title) return 'title-required';
  if (title.length > TITLE_MAX) return 'title-too-long';

  const body = (input.body ?? '').trim();
  if (!body) return 'body-required';
  if (body.length > BODY_MAX) return 'body-too-long';

  if (input.imageUrl != null && input.imageUrl !== '' && !/^https:\/\//.test(input.imageUrl)) {
    return 'image-not-https';
  }

  if (!ACTION_TYPES.has(input.actionType)) return 'action-invalid';

  if (input.actionType === 'open_url') {
    if (!input.actionTarget) return 'action-target-required';
    if (!/^https:\/\//.test(input.actionTarget)) return 'action-target-not-https';
  }
  if (input.actionType === 'open_chat' || input.actionType === 'open_group' || input.actionType === 'open_campaign') {
    if (!input.actionTarget) return 'action-target-required';
  }

  const a = input.audience;
  if (!a || !a.type) return 'audience-invalid';
  switch (a.type) {
    case 'all_users':
      return null;
    case 'organization':
      if (!Array.isArray(a.organizationIds) || a.organizationIds.length === 0) return 'audience-missing-org';
      return null;
    case 'selected_users':
      if (!Array.isArray(a.userIds) || a.userIds.length === 0) return 'audience-missing-users';
      return null;
    case 'single_user':
      if (!Array.isArray(a.userIds) || a.userIds.length !== 1) return 'audience-missing-user';
      return null;
    case 'role':
      if (typeof a.role !== 'string' || !a.role) return 'audience-missing-role';
      if (!ROLES.has(a.role)) return 'audience-role-invalid';
      return null;
    default:
      return 'audience-invalid';
  }
}

export type AudienceScopeError =
  | 'org-admin-cannot-target-all'
  | 'org-admin-cannot-target-role'
  | 'org-admin-org-mismatch';

/**
 * Pure scope guard: can a caller with `callerOrgId` target this audience?
 * `callerOrgId === undefined` ⇒ super (unrestricted). Anything else ⇒ org admin
 * who can only target their own org or selected/single users they'll prove
 * belong to that org server-side.
 */
export function canTargetAudience(
  callerOrgId: string | undefined,
  audience: BroadcastAudienceConfig,
): AudienceScopeError | null {
  if (callerOrgId === undefined) return null;   // super_admin: anything goes
  if (audience.type === 'all_users') return 'org-admin-cannot-target-all';
  if (audience.type === 'role')      return 'org-admin-cannot-target-role';
  if (audience.type === 'organization') {
    const ids = audience.organizationIds ?? [];
    if (ids.length !== 1 || ids[0] !== callerOrgId) return 'org-admin-org-mismatch';
  }
  // selected_users / single_user: caller cross-checks each uid's org server-side.
  return null;
}

export interface BroadcastDisplay { title: string; body: string; imageUrl?: string }
export interface BroadcastDataPayload {
  type: 'admin_broadcast';
  broadcastId: string;
  actionType: BroadcastActionType;
  actionTarget?: string;
}

/** Notification + data payloads. Bodies/titles trimmed; image included only
 *  when https-valid. Sensitive data is never embedded. */
export function buildBroadcastContent(
  broadcastId: string,
  input: BroadcastInput,
): { display: BroadcastDisplay; data: BroadcastDataPayload } {
  const display: BroadcastDisplay = {
    title: input.title.trim(),
    body:  input.body.trim(),
  };
  if (input.imageUrl && /^https:\/\//.test(input.imageUrl)) display.imageUrl = input.imageUrl;

  const data: BroadcastDataPayload = {
    type: 'admin_broadcast',
    broadcastId,
    actionType: input.actionType,
  };
  if (input.actionTarget) data.actionTarget = input.actionTarget;
  return { display, data };
}

/** Split a token list into fixed-size chunks; never returns an empty chunk. */
export function chunkTokens(tokens: string[], size: number = SEND_BATCH_SIZE): string[][] {
  if (size <= 0) throw new Error('chunk size must be > 0');
  const out: string[][] = [];
  for (let i = 0; i < tokens.length; i += size) out.push(tokens.slice(i, i + size));
  return out;
}

/** Mask an FCM token for safe storage/logging (last 6 chars only). */
export function maskFcmToken(t: string | null | undefined): string {
  if (!t) return '';
  if (t.length <= 6) return '••••';
  return '••• ' + t.slice(-6);
}
