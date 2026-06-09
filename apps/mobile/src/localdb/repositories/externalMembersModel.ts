// Pure types + mappers for external members — no DB import, so it loads under
// vitest (the repo itself pulls in the native expo-sqlite connection).

export interface ExternalMemberRow {
  id: string;
  conversation_id: string;
  contact_id: string;
  display_name: string | null;
  phone_e164: string | null;
  normalized_phone: string | null;
  is_registered: number;
  linked_uid: string | null;
  pending: number;
  updated_at: number | null;
}

export interface ExternalMemberView {
  contactId: string;
  displayName: string;
  phoneE164: string;
  normalizedPhone: string;
  isRegistered: boolean;
  linkedUid: string | null;
  pending: boolean;
}

/** Pure row → view mapper. */
export function toExternalMemberView(r: ExternalMemberRow): ExternalMemberView {
  return {
    contactId:       r.contact_id,
    displayName:     r.display_name ?? '',
    phoneE164:       r.phone_e164 ?? '',
    normalizedPhone: r.normalized_phone ?? '',
    isRegistered:    r.is_registered === 1,
    linkedUid:       r.linked_uid,
    pending:         r.pending === 1,
  };
}
