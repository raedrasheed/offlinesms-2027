// Chat history persists only this opaque reference, never protected media,
// captions, author details or a signed URL. Metadata is resolved on display.
export function validClipId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function parseClipReference(json: string | null | undefined): string | null {
  if (!json) return null;
  try { const value = JSON.parse(json)?.clipId; return validClipId(value) ? value : null; }
  catch { return null; }
}

export function clipIdFromUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port) return null;
    let path: string;
    if (url.protocol === 'offlinesms:' && url.hostname === 'clips') path = url.pathname;
    else if (url.protocol === 'https:' && ['links.offlinesms.com', 'offlinesms.com'].includes(url.hostname)) {
      if (!url.pathname.startsWith('/clips/')) return null;
      path = url.pathname.slice('/clips'.length);
    } else return null;
    const match = /^\/([A-Za-z0-9_-]{1,128})\/?$/.exec(path);
    return match?.[1] ?? null;
  } catch { return null; }
}
