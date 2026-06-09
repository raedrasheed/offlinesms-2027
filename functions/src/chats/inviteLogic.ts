// Pure helpers for group invite links (Phase 26). No Firestore here so code
// generation, validation, and the join-decision logic are unit-testable.

import { randomBytes } from 'node:crypto';

export type InviteJoinMode = 'open' | 'approval_required';

// Crockford-ish base32 alphabet (no I/L/O/U → less ambiguous, URL-safe).
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';
const CODE_LEN = 16;

/** High-entropy random invite code (16 chars from a 31-symbol alphabet ≈ 79 bits). */
export function generateInviteCode(rnd: (n: number) => Buffer = randomBytes): string {
  const bytes = rnd(CODE_LEN);
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

const CODE_RE = new RegExp(`^[${ALPHABET}]{8,40}$`);

/** Shape/charset validation for an inbound invite code. */
export function isValidInviteCode(code: unknown): code is string {
  return typeof code === 'string' && CODE_RE.test(code);
}

export type JoinDecision =
  | 'already_member'
  | 'join_open'
  | 'request_pending'
  | 'create_request';

/** Decide what joinGroupByInviteLink should do, given current state. */
export function joinDecision(
  joinMode: InviteJoinMode,
  isMember: boolean,
  hasPendingRequest: boolean,
): JoinDecision {
  if (isMember) return 'already_member';
  if (joinMode === 'open') return 'join_open';
  return hasPendingRequest ? 'request_pending' : 'create_request';
}

/** Is the invite usable right now? (enabled and not revoked.) */
export function inviteUsable(s: { enabled?: boolean; revokedAt?: unknown } | null | undefined): boolean {
  return !!s && s.enabled === true && !s.revokedAt;
}

export interface InvitePreview {
  conversationId: string;
  groupName: string;
  groupPhotoURL: string | null;
  memberCount: number;
  joinMode: InviteJoinMode;
  isMember: boolean;
  hasPendingRequest: boolean;
  status: 'can_join' | 'already_member' | 'request_pending' | 'disabled';
}

/**
 * Build a privacy-safe preview from raw group data + viewer state. Deliberately
 * exposes ONLY name/photo/count/mode — never the member list or phone numbers.
 */
export function buildInvitePreview(args: {
  conversationId: string;
  groupName: string | null | undefined;
  groupPhotoURL: string | null | undefined;
  memberCount: number | null | undefined;
  joinMode: InviteJoinMode;
  usable: boolean;
  isMember: boolean;
  hasPendingRequest: boolean;
}): InvitePreview {
  let status: InvitePreview['status'];
  if (!args.usable) status = 'disabled';
  else if (args.isMember) status = 'already_member';
  else if (args.hasPendingRequest) status = 'request_pending';
  else status = 'can_join';

  return {
    conversationId:    args.conversationId,
    groupName:         (args.groupName ?? 'Group').trim() || 'Group',
    groupPhotoURL:     args.groupPhotoURL ?? null,
    memberCount:       Math.max(0, args.memberCount ?? 0),
    joinMode:          args.joinMode,
    isMember:          args.isMember,
    hasPendingRequest: args.hasPendingRequest,
    status,
  };
}

/** Public invite URL for a code (kept here so mobile + functions agree). */
export function inviteUrl(code: string): string {
  return `https://offlinesms.com/join/${code}`;
}
