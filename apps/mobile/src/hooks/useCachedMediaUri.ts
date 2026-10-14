// Resolve the best URI for a message's media: the persistent cached file when
// available (instant, offline), otherwise an image thumbnail or the voice URL.
// Only viewport prefetch starts caching; mounting an offscreen cell does not.

import { useEffect, useState } from 'react';
import { cachedMediaUri, onMediaCached } from '../media/mediaCache';
import type { Message } from '../lib/conversations';

export function useCachedMediaUri(message: Message): string | null {
  const remote = message.media?.downloadURL || null;
  const localUri = message.media?.localUri || null;
  const [cached, setCached] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setCached(null);
    const stop = onMediaCached(message, uri => { if (active) setCached(uri); });
    cachedMediaUri(message)
      .then((p) => { if (active && p) setCached(p); })
      .catch(() => {});
    return () => { active = false; stop(); };
    // Re-run when the message or its remote URL changes (e.g. after finalize).
  }, [message.id, remote, localUri]);

  return cached || localUri || (message.type === 'image' ? message.media?.thumbnailURL || null : remote);
}
