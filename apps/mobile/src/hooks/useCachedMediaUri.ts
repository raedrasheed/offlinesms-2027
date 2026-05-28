// Resolve the best URI for a message's media: the persistent cached file when
// available (instant, offline), otherwise the remote download URL while it
// caches in the background, or the sender's own still-local file before upload.

import { useEffect, useState } from 'react';
import { ensureCached } from '../media/mediaCache';
import type { Message } from '../lib/conversations';

export function useCachedMediaUri(message: Message): string | null {
  const remote = message.media?.downloadURL || null;
  const localUri = message.media?.localUri || null;
  const [cached, setCached] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setCached(null);
    ensureCached(message)
      .then((p) => { if (active && p) setCached(p); })
      .catch(() => {});
    return () => { active = false; };
    // Re-run when the message or its remote URL changes (e.g. after finalize).
  }, [message.id, remote]);

  return cached || localUri || remote;
}
