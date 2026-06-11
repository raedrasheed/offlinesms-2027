// Pure helpers for the Status module. No Firestore here so the audience and
// validation logic is unit-testable in isolation (mirrors the Phase 3 rules
// helpers in firestore.rules — keep the two in sync).

export type StatusAudience = 'all_contacts' | 'contacts_except' | 'only_share_with';
export type StatusType     = 'text' | 'image' | 'video';

export const STATUS_TTL_MS    = 24 * 60 * 60 * 1000; // statuses expire after 24h
export const STATUS_BODY_MAX  = 700;                  // text status / caption length cap
export const AUDIENCE_LIST_MAX = 256;                 // allowed/excluded list cap

// Media statuses — caps mirror storage.rules (statuses/{uid}/** ≤ 15MB).
export const STATUS_MEDIA_MAX_BYTES = 15 * 1024 * 1024;
export const STATUS_VIDEO_MAX_MS    = 30_000;
export const STATUS_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];
export const STATUS_VIDEO_MIME = ['video/mp4', 'video/quicktime', 'video/webm'];

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

export interface ParsedAudience {
  audienceType:        StatusAudience;
  allowedViewerUids:   string[];
  excludedViewerUids:  string[];
}

/** Parse + normalise the shared audience fields, or return an error code. */
export function parseAudienceInput(data: {
  audienceType?:       unknown;
  allowedViewerUids?:  unknown;
  excludedViewerUids?: unknown;
}): ParsedAudience | string {
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
    audienceType,
    allowedViewerUids:  audienceType === 'only_share_with' ? allowed : [],
    excludedViewerUids: audienceType === 'only_share_with' ? [] : excluded,
  };
}

export interface TextStatusInput extends ParsedAudience {
  body:            string;
  backgroundColor: string;
}

/**
 * Validate + normalise a text createStatus payload. Returns the cleaned
 * input, or an error code string (used verbatim as the HttpsError message).
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

  const audience = parseAudienceInput(data);
  if (typeof audience === 'string') return audience;

  return { body, backgroundColor, ...audience };
}

export interface MediaStatusInput extends ParsedAudience {
  type:        'image' | 'video';
  body:        string;          // optional caption ('' when none)
  mediaUrl:    string;
  storagePath: string;
  mimeType:    string;
  sizeBytes:   number;
  durationMs:  number | null;   // video only
}

/**
 * Validate + normalise an image/video createStatus payload. `authorUid` pins
 * the storagePath to the caller's own statuses/{uid}/ folder so a status can
 * never reference (and outlive-delete) someone else's upload.
 */
export function validateMediaStatusInput(
  data: {
    type?:               unknown;
    body?:               unknown;
    mediaUrl?:           unknown;
    storagePath?:        unknown;
    mimeType?:           unknown;
    sizeBytes?:          unknown;
    durationMs?:         unknown;
    audienceType?:       unknown;
    allowedViewerUids?:  unknown;
    excludedViewerUids?: unknown;
  },
  authorUid: string,
): MediaStatusInput | string {
  if (data.type !== 'image' && data.type !== 'video') return 'type-unsupported';
  const type = data.type;

  let body = '';
  if (data.body !== undefined) {
    if (typeof data.body !== 'string') return 'caption-invalid';
    body = data.body.trim();
    if (body.length > STATUS_BODY_MAX) return 'caption-too-long';
  }

  if (typeof data.mediaUrl !== 'string' || !data.mediaUrl.startsWith('https://')) {
    return 'media-url-invalid';
  }

  if (typeof data.storagePath !== 'string'
      || !data.storagePath.startsWith(`statuses/${authorUid}/`)
      || data.storagePath.includes('..')) {
    return 'storage-path-invalid';
  }

  if (typeof data.mimeType !== 'string') return 'mime-required';
  const mimeType = data.mimeType.toLowerCase();
  const allow = type === 'image' ? STATUS_IMAGE_MIME : STATUS_VIDEO_MIME;
  if (!allow.includes(mimeType)) return 'mime-not-allowed';

  const sizeBytes = typeof data.sizeBytes === 'number' ? data.sizeBytes : 0;
  if (!(sizeBytes > 0) || sizeBytes > STATUS_MEDIA_MAX_BYTES) return 'size-invalid';

  let durationMs: number | null = null;
  if (type === 'video') {
    durationMs = typeof data.durationMs === 'number' ? data.durationMs : null;
    if (durationMs == null || !(durationMs > 0)) return 'duration-required';
    if (durationMs > STATUS_VIDEO_MAX_MS) return 'duration-too-long';
  }

  const audience = parseAudienceInput(data);
  if (typeof audience === 'string') return audience;

  return {
    type, body,
    mediaUrl: data.mediaUrl, storagePath: data.storagePath,
    mimeType, sizeBytes, durationMs,
    ...audience,
  };
}
