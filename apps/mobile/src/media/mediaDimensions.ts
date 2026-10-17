export type MediaDimensions = { width: number; height: number };

export function validMediaDimensions(width?: number | null, height?: number | null): MediaDimensions | null {
  return typeof width === 'number' && typeof height === 'number' &&
    Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height } : null;
}

/** Fit BOTH axes together. Clamping height alone crops portrait/panorama media. */
export function fitMediaDimensions(dimensions: MediaDimensions | null, maxWidth: number, maxHeight: number): MediaDimensions {
  const source = dimensions ?? { width: 4, height: 3 };
  const scale = Math.min(Math.max(1, maxWidth) / source.width, Math.max(1, maxHeight) / source.height);
  return { width: source.width * scale, height: source.height * scale };
}

/** Some native decoders report encoded dimensions separately from rotation. */
export function videoDisplayDimensions(size: MediaDimensions & { orientation?: string }): MediaDimensions | null {
  const dimensions = validMediaDimensions(size.width, size.height);
  if (!dimensions) return null;
  if ((size.orientation === 'portrait' && size.width > size.height) ||
      (size.orientation === 'landscape' && size.height > size.width)) {
    return { width: size.height, height: size.width };
  }
  return dimensions;
}
