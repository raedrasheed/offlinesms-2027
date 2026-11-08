import { isCustomStickerMessage, validCustomStickerMetadata } from './attachmentModel';

type Candidate = {
  type?: string; text?: unknown; caption?: unknown;
  media?: { presentation?: unknown; fileName?: unknown; mimeType?: unknown; sizeBytes?: unknown; width?: unknown; height?: unknown } | null;
};
const stickerFile = /^sticker(?:-[a-z0-9-]{1,80})?\.png$/i;

/** Display compatibility for older servers that dropped the presentation flag.
 * Never infer a sticker from PNG format or square dimensions alone. */
export function isStickerImage(message: Candidate): boolean {
  if (isCustomStickerMessage(message)) return true;
  const media = message.media;
  if (message.type !== 'image' || media?.presentation != null
    || typeof message.caption === 'string' && message.caption.trim()
    || !validCustomStickerMetadata(media ?? {})) return false;
  return typeof media?.fileName === 'string' && stickerFile.test(media.fileName)
    || typeof message.text === 'string' && /^(?:Sticker(?:: sticker(?:-[a-z0-9-]{1,80})?\.png)?|Photo: sticker(?:-[a-z0-9-]{1,80})?\.png)$/i.test(message.text);
}
