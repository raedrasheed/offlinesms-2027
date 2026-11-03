import { getFunctions, httpsCallable } from 'firebase/functions';
import { onAuthStateChanged } from 'firebase/auth';
import NetInfo from '@react-native-community/netinfo';
import { app, auth } from './firebase';
import { saveClipDraft, type ClipDraft } from './clipDrafts';
import { startClipSourceUpload } from './clipSourceUpload';
import { sanitizeClipUploadError, type ClipUploadStage } from './clipUploadErrors';

export interface ClipUploadProgress {
  transferredBytes: number; totalBytes: number; progress: number; state: 'running' | 'paused' | 'processing';
}
export interface ClipUploadHandle {
  pause(): void; resume(): void; cancel(): void;
  done: Promise<{ clipId: string; status: 'processing' }>;
}
function callable<T, R>(name: string, data: T): Promise<R> {
  return httpsCallable<T, R>(getFunctions(app, 'us-central1'), name)(data).then(r => r.data);
}

/** Native resumable uploads pause/retry across temporary network loss. A killed
 * process restarts upload from the durable local draft to the same initialized
 * object; it never publishes duplicate clips or pretends bytes survived a kill. */
export async function startClipUpload(input: ClipDraft, callbacks: {
  onProgress?: (progress: ClipUploadProgress) => void;
} = {}): Promise<ClipUploadHandle> {
  const uid = auth.currentUser?.uid;
  if (!uid || input.uid !== uid) throw new Error('clip-draft-owner-mismatch');
  if (!input.audience) throw new Error('audience-invalid');
  let draft = await saveClipDraft({ ...input, errorCode: undefined });
  let task: ReturnType<typeof startClipSourceUpload> | null = null;
  let cancelled = false, sessionChanged = false, manualPause = false, networkPause = false;
  let stage: ClipUploadStage = 'initialize';
  let snapshot: ClipUploadProgress = { transferredBytes: 0, totalBytes: draft.sizeBytes, progress: 0, state: 'running' };
  const check = () => {
    if (sessionChanged || auth.currentUser?.uid !== uid) throw new Error('clip-session-changed');
    if (cancelled) throw new Error('clip-upload-cancelled');
  };
  const progress = (state: ClipUploadProgress['state']) => {
    snapshot = { ...snapshot, state }; callbacks.onProgress?.(snapshot);
  };
  const stopAuth = onAuthStateChanged(auth, user => { if (user?.uid !== uid) { sessionChanged = true; task?.cancel(); } });
  const stopNetwork = NetInfo.addEventListener(state => {
    if (state.isConnected === false || state.isInternetReachable === false) { networkPause = true; task?.pause(); }
    else if (state.isConnected === true) { networkPause = false; if (!manualPause) task?.resume(); }
  });
  const done = (async (): Promise<{ clipId: string; status: 'processing' }> => {
    try {
      check();
      const initialized = await callable<{ draftId: string }, { clipId: string; storagePath: string; maxUploadBytes: number; status: string }>('initClipUpload', { draftId: draft.id });
      check();
      draft = await saveClipDraft({ ...draft, clipId: initialized.clipId });
      check();
      if (!['processing', 'pending_review', 'published'].includes(initialized.status)) {
        stage = 'upload';
        draft = await saveClipDraft({ ...draft, status: 'uploading' });
        check();
        task = startClipSourceUpload({ uid, localUri: draft.localUri, storagePath: initialized.storagePath,
          contentType: draft.mimeType, maxUploadBytes: initialized.maxUploadBytes,
          onProgress: event => { snapshot = event; callbacks.onProgress?.(snapshot); },
        });
        if (manualPause || networkPause) task.pause();
        await task.done;
        check(); draft = await saveClipDraft({ ...draft, status: 'uploaded' });
        check(); stage = 'publish';
        progress('processing');
        await callable('publishClip', {
          clipId: initialized.clipId, caption: draft.caption, audience: draft.audience, groupId: draft.groupId,
          allowComments: draft.allowComments, allowDownload: draft.allowDownload,
          trimStartMs: draft.trimStartMs, trimEndMs: draft.trimEndMs, coverTimeMs: draft.coverTimeMs,
          overlayText: draft.overlayText, mute: draft.mute,
        });
      }
      check(); await saveClipDraft({ ...draft, status: 'processing', errorCode: undefined });
      return { clipId: initialized.clipId, status: 'processing' };
    } catch (error) {
      const safe = sanitizeClipUploadError(sessionChanged ? new Error('clip-session-changed') : error);
      if (auth.currentUser?.uid === uid) await saveClipDraft({ ...draft, status: cancelled ? 'draft' : 'failed',
        errorCode: cancelled ? undefined : safe.code }).catch(() => {});
      // Never log native responses, session URLs, tokens, or local file paths.
      if (!cancelled && !sessionChanged) console.warn(`[clips-upload] stage=${stage} code=${safe.code}`);
      throw Object.assign(new Error(safe.code), { code: safe.code, clipUploadStage: stage });
    } finally { stopAuth(); stopNetwork(); }
  })();
  return { done,
    pause() { manualPause = true; task?.pause(); progress('paused'); },
    resume() { manualPause = false; if (!networkPause) task?.resume(); progress(networkPause ? 'paused' : 'running'); },
    cancel() { cancelled = true; task?.cancel(); },
  };
}
