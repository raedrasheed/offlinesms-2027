// Resolve the best URI for a message's media: the persistent cached file when
// available (instant, offline), otherwise an image thumbnail or the voice URL.
// Only viewport prefetch starts caching; mounting an offscreen cell does not.

import { useEffect, useState } from 'react';
import { isStickerImage } from '../media/stickerPresentation';
import { cachedMediaUri, onMediaCached } from '../media/mediaCache';
import type { Message } from '../lib/conversations';

export function useCachedMediaUri(message: Message): string | null {
  const remote = message.media?.downloadURL || null;
  const localUri = message.media?.localUri || null;
  const source = JSON.stringify([message.conversationId, message.id, remote, localUri]);
  const [cached, setCached] = useState<{ source: string; uri: string } | null>(null);

  useEffect(() => {
    let active = true;
    setCached(null);
    const stop = onMediaCached(message, uri => { if (active) setCached({ source, uri }); });
    cachedMediaUri(message)
      .then((p) => { if (active && p) setCached({ source, uri: p }); })
      .catch(() => {});
    return () => { active = false; stop(); };
    // Re-run when the message or its remote URL changes (e.g. after finalize).
  }, [source]);

  // Sticker thumbnails may be JPEGs. Only the original/cached PNG retains alpha.
  return (cached?.source === source ? cached.uri : null) || localUri
    || (message.type === 'image' && !isStickerImage(message) ? message.media?.thumbnailURL || remote : remote);
}
