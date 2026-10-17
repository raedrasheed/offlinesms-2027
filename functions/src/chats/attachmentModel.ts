// Attachment payload contract. Keep the mobile/server copies in sync (parity-tested).
export type BinaryAttachmentType = 'image' | 'voice' | 'file' | 'audio' | 'video';
export type LocationAttachment = { latitude: number; longitude: number; accuracy?: number; capturedAt?: number; label?: string };
// uid identifies an OfflineSMS account. Phone/email-only cards from older builds
// remain readable; new app cards never include private contact details.
export type ContactAttachment = { name: string; uid?: string; username?: string; phones: string[]; emails: string[] };
export type StructuredAttachment = { kind: 'location'; location: LocationAttachment } | { kind: 'contact'; contact: ContactAttachment };

export const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/m4a': 'm4a', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv',
  'application/msword': 'doc', 'application/vnd.ms-excel': 'xls', 'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/zip': 'zip',
};
export const DOCUMENT_MIMES = Object.keys(MIME_EXTENSIONS).filter(m => m.startsWith('application/') || m.startsWith('text/'));
export const VOICE_MIMES = ['audio/m4a', 'audio/aac', 'audio/mp4', 'audio/x-m4a'];
export function isBinaryAttachment(type: unknown): type is BinaryAttachmentType {
  return ['image', 'voice', 'file', 'audio', 'video'].includes(String(type));
}
export function attachmentLimit(type: BinaryAttachmentType): number {
  return (type === 'image' || type === 'voice' ? 10 : 25) * 1024 * 1024;
}
export function attachmentMimeAllowed(type: BinaryAttachmentType, mime: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(MIME_EXTENSIONS, mime)) return false;
  if (type === 'voice') return VOICE_MIMES.includes(mime);
  if (type === 'file') return DOCUMENT_MIMES.includes(mime);
  return mime.startsWith(type + '/');
}
export function attachmentLabel(type: BinaryAttachmentType): string {
  return { image: 'Photo', voice: 'Voice message', file: 'File', audio: 'Audio', video: 'Video' }[type];
}
export function cleanFileName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const name = value.replace(/[\\/\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '_').trim();
  if (name.length <= 180) return name;
  const extension = name.match(/\.[a-z0-9]{1,10}$/i)?.[0] ?? '';
  return name.slice(0, 180 - extension.length) + extension;
}
export function normalizeAttachmentMime(mime: string): string {
  return mime.split(';')[0].trim().toLowerCase();
}
export function inferAttachmentMime(name: string, mime?: string | null): string {
  const normalized = normalizeAttachmentMime(mime ?? '');
  if (Object.prototype.hasOwnProperty.call(MIME_EXTENSIONS, normalized)) return normalized;
  const ext = name.toLowerCase().split('.').pop();
  return Object.keys(MIME_EXTENSIONS).find(k => MIME_EXTENSIONS[k] === ext) ?? normalized;
}
export function parseLocation(value: unknown): LocationAttachment | null {
  const v = value as Partial<LocationAttachment> | null;
  if (!v || typeof v.latitude !== 'number' || typeof v.longitude !== 'number'
    || !Number.isFinite(v.latitude) || !Number.isFinite(v.longitude)
    || Math.abs(v.latitude) > 90 || Math.abs(v.longitude) > 180) return null;
  return { latitude: v.latitude, longitude: v.longitude,
    ...(typeof v.accuracy === 'number' && Number.isFinite(v.accuracy) && v.accuracy >= 0 ? { accuracy: v.accuracy } : {}),
    ...(typeof v.capturedAt === 'number' && Number.isFinite(v.capturedAt) && v.capturedAt > 0 ? { capturedAt: v.capturedAt } : {}),
    ...(typeof v.label === 'string' ? { label: v.label.trim().slice(0, 160) } : {}),
  };
}
export function parseContact(value: unknown): ContactAttachment | null {
  const v = value as Partial<ContactAttachment> | null;
  if (!v || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 160) return null;
  const name = v.name.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (!name) return null;
  if (v.uid !== undefined) {
    if (typeof v.uid !== 'string' || !v.uid || v.uid.length > 128 || v.uid !== v.uid.trim()
      || /[\/\x00-\x1f\x7f]/.test(v.uid) || v.uid === '.' || v.uid === '..' || v.uid.startsWith('ext:')) return null;
    const username = typeof v.username === 'string' && /^[a-z0-9._]{3,20}$/.test(v.username) ? v.username : undefined;
    return { uid: v.uid, name, ...(username ? { username } : {}), phones: [], emails: [] };
  }
  if (!Array.isArray(v.phones) || !Array.isArray(v.emails) || v.phones.length > 5 || v.emails.length > 5) return null;
  if (v.phones.some(p => typeof p !== 'string' || !/^[+\d ()-]{3,40}$/.test(p))) return null;
  if (v.emails.some(e => typeof e !== 'string' || e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) return null;
  const phones = [...new Set(v.phones.map(p => p.trim()))];
  const emails = [...new Set(v.emails.map(e => e.trim()))];
  return phones.length || emails.length ? { name, phones, emails } : null;
}
export function locationUrl(location: LocationAttachment): string {
  return `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;
}
export function attachmentFallback(a: StructuredAttachment): string {
  return a.kind === 'location' ? `📍 ${a.location.label || 'Location'}\n${locationUrl(a.location)}`
    : a.contact.uid ? `👤 ${a.contact.name}\nOfflineSMS${a.contact.username ? ` · @${a.contact.username}` : ''}`
    : `👤 ${a.contact.name}\n${[...a.contact.phones, ...a.contact.emails].join('\n')}`;
}
export function parsePayload(json: string | null | undefined): Record<string, any> {
  try { const v = JSON.parse(json || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

/** Custom stickers retain image transport for older clients. */
export const CUSTOM_STICKER_MAX_BYTES = 2 * 1024 * 1024;
export function isCustomStickerMessage(message: {type?: string; media?: {presentation?: unknown} | null}): boolean {
  return message.type === 'image' && message.media?.presentation === 'sticker';
}
export function validCustomStickerMetadata(media: {mimeType?: unknown; sizeBytes?: unknown; width?: unknown; height?: unknown}): boolean {
  return media.mimeType === 'image/png' && media.width === 512 && media.height === 512
    && typeof media.sizeBytes === 'number' && Number.isSafeInteger(media.sizeBytes)
    && media.sizeBytes > 0 && media.sizeBytes <= CUSTOM_STICKER_MAX_BYTES;
}
