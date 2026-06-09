// Pure helpers for external phone contacts (Phase 25). No Firestore here so the
// id/dedupe/shape logic is unit-testable in isolation.

import { phoneDigits } from '../lib/phone';

/**
 * Deterministic id for a user's private phone contact: owner-scoped + phone.
 * Same owner + same number → same id → natural dedupe (no duplicate variants).
 */
export function phoneContactId(ownerUid: string, e164: string): string {
  return `${ownerUid}_${phoneDigits(e164)}`;
}

/**
 * Deterministic id for a group's external member: phone-only (NOT owner-scoped)
 * so a group can never hold the same number twice, even if two different admins
 * add it. The owning contact ref + who added it are stored as fields.
 */
export function externalMemberId(e164: string): string {
  return phoneDigits(e164);
}

export interface PhoneContactDoc {
  contactId: string;
  ownerUid: string;
  organizationId: string | null;
  displayName: string;
  phoneE164: string;
  normalizedPhone: string;
  isRegistered: boolean;
  linkedUid: string | null;
}

/** Build the persisted phoneContacts doc shape (timestamps added by caller). */
export function newPhoneContactDoc(args: {
  ownerUid: string;
  organizationId?: string | null;
  displayName: string;
  e164: string;
  linkedUid?: string | null;
}): PhoneContactDoc {
  const linkedUid = args.linkedUid ?? null;
  return {
    contactId:       phoneContactId(args.ownerUid, args.e164),
    ownerUid:        args.ownerUid,
    organizationId:  args.organizationId ?? null,
    displayName:     args.displayName.trim(),
    phoneE164:       args.e164,
    normalizedPhone: phoneDigits(args.e164),
    isRegistered:    !!linkedUid,
    linkedUid,
  };
}

export interface ExternalMemberDoc {
  contactId: string;
  displayName: string;
  phoneE164: string;
  normalizedPhone: string;
  isRegistered: boolean;
  linkedUid: string | null;
  addedByUid: string;
}

/** Build the persisted externalMembers doc shape (timestamps added by caller). */
export function newExternalMemberDoc(args: {
  contactId: string;
  displayName: string;
  e164: string;
  addedByUid: string;
  linkedUid?: string | null;
}): ExternalMemberDoc {
  const linkedUid = args.linkedUid ?? null;
  return {
    contactId:       args.contactId,
    displayName:     args.displayName.trim(),
    phoneE164:       args.e164,
    normalizedPhone: phoneDigits(args.e164),
    isRegistered:    !!linkedUid,
    linkedUid,
    addedByUid:      args.addedByUid,
  };
}

const NAME_MAX = 80;

/** Validate + clean a display name. Returns the trimmed name or null. */
export function cleanDisplayName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const n = input.trim();
  if (n.length === 0 || n.length > NAME_MAX) return null;
  return n;
}
