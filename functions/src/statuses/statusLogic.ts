// Pure helpers for the Status module. No Firestore here so the audience and
// validation logic is unit-testable in isolation (mirrors the Phase 3 rules
// helpers in firestore.rules — keep the two in sync).

export type StatusAudience = 'all_contacts' | 'contacts_except' | 'only_share_with';

export const STATUS_TTL_MS    = 24 * 60 * 60 * 1000; // statuses expire after 24h
export const STATUS_BODY_MAX  = 700;                  // text status length cap
export const AUDIENCE_LIST_MAX = 256;                 // allowed/excluded list cap

const AUDIENCES = new Set<StatusAudience>(['all_contacts', 'contacts_except', 'only_share_with']);

/** Solid-background palette for text statuses (also rendered by the client). */
export const STATUS_BG_COLORS = [
  '#075E54', '#128C7E', '#1F7BA8', '#5B3CC4',
  '#C2185B', '#D84315', '#37474F', '#7B1FA2',
] as const;

export interface StatusAudienceFields {
  audienceType?:       StatusAudience;
  allowedViewerUids?:  string[];
  excludedViewerUids?: string[];
}

/**
 * Whether `viewerUid` may see a status with the given audience fields.
 * Default semantics: missing audienceType behaves like 'all_contacts'.
 * Mirrors `isStatusAudienceMember()` in firestore.rules and the original
 * markStatusViewed check.
 */
export function isStatusAudienceMember(s: StatusAudienceFields, viewerUid: string): boolean {
  const t = s.audienceType ?? 'all_contacts';
  const allowed  = s.allowedViewerUids ?? [];
  const excluded = s.excludedViewerUids ?? [];

  if (t === 'all_contacts')    return !excluded.includes(viewerUid);
  if (t === 'contacts_except') return !excluded.includes(viewerUid);
  if (t === 'only_share_with') return allowed.includes(viewerUid);
  return false;
}

export interface TextStatusInput {
  body:                string;
  backgroundColor:     string;
  audienceType:        StatusAudience;
  allowedViewerUids:   string[];
  excludedViewerUids:  string[];
}

/**
 * Validate + normalise a createStatus payload. Returns the cleaned input,
 * or an error code string (used verbatim as the HttpsError message).
 */
export function validateTextStatusInput(data: {
  body?:               unknown;
  backgroundColor?:    unknown;
  audienceType?:       unknown;
  allowedViewerUids?:  unknown;
  excludedViewerUids?: unknown;
}): TextStatusInput | string {
  if (typeof data.body !== 'string') return 'body-required';
  const body = data.body.trim();
  if (body.length === 0) return 'body-empty';
  if (body.length > STATUS_BODY_MAX) return 'body-too-long';

  let backgroundColor: string = STATUS_BG_COLORS[0];
  if (data.backgroundColor !== undefined) {
    if (typeof data.backgroundColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(data.backgroundColor)) {
      return 'background-color-invalid';
    }
    backgroundColor = data.backgroundColor.toUpperCase();
  }

  let audienceType: StatusAudience = 'all_contacts';
  if (data.audienceType !== undefined) {
    if (typeof data.audienceType !== 'string' || !AUDIENCES.has(data.audienceType as StatusAudience)) {
      return 'audience-invalid';
    }
    audienceType = data.audienceType as StatusAudience;
  }

  const cleanList = (v: unknown): string[] | string => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) return 'audience-list-invalid';
    const uids = Array.from(new Set(v.filter(x => typeof x === 'string' && x.length > 0))) as string[];
    if (uids.length > AUDIENCE_LIST_MAX) return 'audience-list-too-long';
    return uids;
  };

  const allowed = cleanList(data.allowedViewerUids);
  if (typeof allowed === 'string') return allowed;
  const excluded = cleanList(data.excludedViewerUids);
  if (typeof excluded === 'string') return excluded;

  if (audienceType === 'only_share_with' && allowed.length === 0) {
    return 'audience-list-empty';
  }

  return {
    body,
    backgroundColor,
    audienceType,
    allowedViewerUids:  audienceType === 'only_share_with' ? allowed : [],
    excludedViewerUids: audienceType === 'only_share_with' ? [] : excluded,
  };
}
