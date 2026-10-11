// Phase 23 — pure media-message validation and helpers.
//
// Shared by the composer, the upload outbox and the bubbles. Kept dependency-free
// so it is unit-testable and can mirror the server-side checks in the callables
// (the real security boundary lives in functions/src/chats/*MediaMessage.ts).

export type MediaType = 'image' | 'voice';

export const IMAGE_MIME_ALLOW = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const AUDIO_MIME_ALLOW = ['audio/m4a', 'audio/aac', 'audio/mp4', 'audio/x-m4a'] as const;

export const MAX_MEDIA_BYTES = 10 * 1024 * 1024; // 10 MB (image and voice)
export const VOICE_MAX_MS = 5 * 60 * 1000;       // 5 minutes
export const VOICE_MIN_MS = 1000;                // 1 second
export const WAVEFORM_MAX_BARS = 56;

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason:
      | 'unsupported-type' | 'mime-not-allowed' | 'too-large'
      | 'duration-missing' | 'too-short' | 'too-long' };

export function isAllowedImageMime(mime: string): boolean {
  return (IMAGE_MIME_ALLOW as readonly string[]).includes(mime.toLowerCase());
}

export function isAllowedAudioMime(mime: string): boolean {
  return (AUDIO_MIME_ALLOW as readonly string[]).includes(mime.toLowerCase());
}

export function isAllowedMime(type: MediaType, mime: string): boolean {
  return type === 'image' ? isAllowedImageMime(mime) : isAllowedAudioMime(mime);
}

/** Validate a media message's metadata before upload. Pure; no I/O. */
export function validateMediaMessage(input: {
  mediaType: MediaType;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number | null;
}): ValidationResult {
  if (input.mediaType !== 'image' && input.mediaType !== 'voice') {
    return { ok: false, reason: 'unsupported-type' };
  }
  if (!isAllowedMime(input.mediaType, input.mimeType)) {
    return { ok: false, reason: 'mime-not-allowed' };
  }
  if (!(input.sizeBytes > 0) || input.sizeBytes > MAX_MEDIA_BYTES) {
    return { ok: false, reason: 'too-large' };
  }
  if (input.mediaType === 'voice') {
    if (input.durationMs == null) return { ok: false, reason: 'duration-missing' };
    if (input.durationMs < VOICE_MIN_MS) return { ok: false, reason: 'too-short' };
    if (input.durationMs > VOICE_MAX_MS) return { ok: false, reason: 'too-long' };
  }
  return { ok: true };
}

/**
 * Downsample arbitrary metering samples into a fixed-length bar array in [0,1].
 * Buckets are averaged; an all-zero/empty input yields an empty array (the
 * bubble falls back to a flat placeholder). Never throws — waveform is cosmetic.
 */
export function normalizeWaveform(samples: number[], bars = WAVEFORM_MAX_BARS): number[] {
  if (!Array.isArray(samples) || samples.length === 0 || bars <= 0) return [];
  const clean = samples.map((s) => (Number.isFinite(s) ? Math.max(0, s) : 0));
  const peak = clean.reduce((m, s) => (s > m ? s : m), 0);
  if (peak <= 0) return new Array(Math.min(bars, clean.length)).fill(0);

  const out: number[] = [];
  const bucket = clean.length / bars;
  for (let i = 0; i < bars; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucket));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end && j < clean.length; j++) { sum += clean[j]; n++; }
    out.push(n > 0 ? Math.min(1, sum / n / peak) : 0);
  }
  return out;
}

/** Format a duration in ms as "m:ss" (e.g. 64000 → "1:04"). Clamps negatives. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Conversation list / lastMessage preview label for a media message. */
export function mediaPreviewLabel(type: MediaType): 'Photo' | 'Voice message' {
  return type === 'image' ? 'Photo' : 'Voice message';
}

export type AttachmentKey =
  | 'photos' | 'camera' | 'file' | 'location' | 'contact' | 'poll' | 'audio' | 'gif';

export interface AttachmentOption {
  key: AttachmentKey;
  /** i18n key for the label. */
  labelKey: string;
  icon: string; // Ionicons glyph name
  enabled: boolean;
}

/**
 * The 8 attachment-sheet tiles. Only Photos and Camera are enabled in Phase 23;
 * the rest render as "coming soon" so the sheet matches the design without
 * shipping unfinished flows.
 */
export const ATTACHMENT_OPTIONS: readonly AttachmentOption[] = [
  { key: 'photos',   labelKey: 'media.photo',   icon: 'image',            enabled: true },
  { key: 'camera',   labelKey: 'media.camera',  icon: 'camera',           enabled: true },
  { key: 'file',     labelKey: 'media.file',    icon: 'document',         enabled: false },
  { key: 'location', labelKey: 'media.location', icon: 'location',        enabled: false },
  { key: 'contact',  labelKey: 'media.contact', icon: 'person',           enabled: false },
  { key: 'poll',     labelKey: 'media.poll',    icon: 'stats-chart',      enabled: true },
  { key: 'audio',    labelKey: 'media.audio',   icon: 'musical-notes',    enabled: false },
  { key: 'gif',      labelKey: 'media.gif',     icon: 'film',             enabled: false },
];
