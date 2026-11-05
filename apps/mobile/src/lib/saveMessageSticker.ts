import { isStickerImage } from '../media/stickerPresentation';
import type { Message } from './conversations';
import { saveCustomSticker } from './customStickers';
import { DEFAULT_STICKER_EDITS } from './stickerEditorModel';
import { validCustomStickerMetadata } from '../media/attachmentModel';
import { ensureCached } from '../media/mediaCache';

/** Save the full, verified sticker into an independent, durable local library. */
export async function saveMessageSticker(uid: string, message: Message, name: string) {
  if (!uid || !message.id || !message.conversationId || message.deletedForEveryone
    || !isStickerImage(message) || !validCustomStickerMetadata(message.media ?? {})
    || message.media?.uploadStatus !== 'uploaded') throw Error('sticker-invalid');
  // Never import the thumbnail/remote preview URI. Use the original cached PNG,
  // and copy it before the chat/cache can be removed by retention or deletion.
  const uri = await ensureCached(message);
  if (!uri) throw Error('sticker-download-failed');
  return saveCustomSticker(uid, {
    name, sourceUri: uri, imageUri: uri, sourceWidth: 512, sourceHeight: 512,
    edits: { ...DEFAULT_STICKER_EDITS, removeBackground: false },
    sourceMessageKey: `${message.conversationId}/${message.id}`,
  });
}
