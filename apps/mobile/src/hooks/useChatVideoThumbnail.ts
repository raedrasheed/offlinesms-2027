import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import type { Message } from '../lib/conversations';
import { chatVideoThumbnailKey, ensureChatVideoThumbnail } from '../lib/chatVideoThumbnails';
import { isOnline, onConnectivityChange } from '../localdb/sync/networkState';
import { getCurrentUid, getDb } from '../localdb/connection';
import { hydrateChatVideoThumbnail } from '../localdb/repositories/messagesRepo';

/** Visible chat videos request a server-generated image, never the original
 * video. A temporary document listener also covers old paged-history rows. */
export function useChatVideoThumbnail(message: Message, uid: string, visible: boolean): string | null {
  const [authUid, setAuthUid] = useState(auth.currentUser?.uid ?? '');
  const source = message.media?.storagePath || message.media?.downloadURL || '';
  const input = { uid, conversationId: message.conversationId, messageId: message.id, source };
  const key = chatVideoThumbnailKey(input);
  const current = useRef(key); current.current = key;
  const existing = message.media?.thumbnailURL || null;
  const [resolved, setResolved] = useState<{ key: string; url: string | null }>({ key: '', url: null });
  const eligible = message.type === 'video' && !message.deletedForEveryone
    && (message.media?.uploadStatus ?? 'uploaded') === 'uploaded' && !!source;
  useEffect(() => {
    if (!visible) return;
    setAuthUid(auth.currentUser?.uid ?? '');
    return onAuthStateChanged(auth, user => setAuthUid(user?.uid ?? ''));
  }, [visible]);
  useEffect(() => {
    if (!visible || !eligible || !uid || uid !== authUid || existing) return;
    let live = true, foreground = AppState.currentState === 'active', online = isOnline(), generation = 0;
    let unsubscribe: (() => void) | undefined;
    const allowed = () => live && foreground && online && auth.currentUser?.uid === uid && current.current === key;
    const stop = () => { generation++; unsubscribe?.(); unsubscribe = undefined; };
    const accept = (url: string, path?: string | null) => {
      setResolved({ key, url });
      try {
        if (!allowed() || getCurrentUid() !== uid) return;
        const database = getDb();
        void hydrateChatVideoThumbnail({ conversationId: input.conversationId, messageId: input.messageId,
          source, thumbnailURL: url, thumbnailPath: path }, database).catch(() => {});
      } catch { /* The non-SQLite chat path can still display the cover. */ }
    };
    const refresh = () => {
      stop(); if (!allowed()) return;
      const attempt = generation;
      void ensureChatVideoThumbnail(input, allowed).then(result => {
        if (!allowed() || attempt !== generation || !result) return;
        if (result.state === 'ready') {
          if (typeof result.thumbnailURL === 'string' && result.thumbnailURL) accept(result.thumbnailURL, result.thumbnailPath);
          return;
        }
        if (result.state !== 'pending') return;
        const stopSnapshot = onSnapshot(doc(db, 'conversations', input.conversationId, 'messages', input.messageId), snapshot => {
          if (!allowed() || attempt !== generation) return;
          const value = snapshot.data();
          if (!value || value.deletedForEveryone || value.retentionDeleting) { setResolved({ key, url: null }); stop(); return; }
          const sameSource = (value.media?.storagePath || value.media?.downloadURL || '') === source;
          if (!sameSource) { stop(); return; }
          if (value.media?.thumbnailState === 'failed') { stop(); return; }
          const url = value.media?.thumbnailURL;
          if (typeof url === 'string' && url) { accept(url, value.media?.thumbnailPath); stop(); }
        }, () => { if (attempt === generation) stop(); });
        if (!allowed() || attempt !== generation) stopSnapshot(); else unsubscribe = stopSnapshot;
      });
    };
    const appSubscription = AppState.addEventListener('change', state => { foreground = state === 'active'; refresh(); });
    const disconnect = onConnectivityChange(value => { online = value; refresh(); });
    refresh();
    return () => { live = false; stop(); appSubscription.remove(); disconnect(); };
  }, [key, uid, authUid, visible, eligible, existing]);
  if (!uid || uid !== authUid || auth.currentUser?.uid !== uid || !eligible) return null;
  return existing || (resolved.key === key ? resolved.url : null);
}
