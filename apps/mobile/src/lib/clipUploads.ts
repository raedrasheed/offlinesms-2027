import { getFunctions, httpsCallable } from 'firebase/functions';
import { ref, uploadBytesResumable, type UploadTask } from 'firebase/storage';
import { onAuthStateChanged } from 'firebase/auth';
import NetInfo from '@react-native-community/netinfo';
import { app, auth, storage } from './firebase';
import { saveClipDraft, type ClipDraft } from './clipDrafts';

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

/** SDK resumable uploads pause/retry across temporary network loss. A killed
 * process restarts upload from the durable local draft to the same initialized
 * object; it never publishes duplicate clips or pretends bytes survived a kill. */
export async function startClipUpload(input: ClipDraft, callbacks: {
  onProgress?: (progress: ClipUploadProgress) => void;
} = {}): Promise<ClipUploadHandle> {
  const uid = auth.currentUser?.uid;
  if (!uid || input.uid !== uid) throw new Error('clip-draft-owner-mismatch');
  if (!input.audience) throw new Error('audience-invalid');
  let draft = await saveClipDraft({ ...input, errorCode: undefined }), task: UploadTask | null = null;
  let cancelled = false, manualPause = false, networkPause = false;
  const check = () => { if (cancelled || auth.currentUser?.uid !== uid) throw new Error(cancelled ? 'clip-upload-cancelled' : 'clip-session-changed'); };
  const progress = (state: ClipUploadProgress['state']) => callbacks.onProgress?.({
    transferredBytes: task?.snapshot.bytesTransferred ?? 0, totalBytes: task?.snapshot.totalBytes ?? draft.sizeBytes,
    progress: task ? task.snapshot.bytesTransferred / Math.max(1, task.snapshot.totalBytes) : 0, state,
  });
  const stopAuth = onAuthStateChanged(auth, user => { if (user?.uid !== uid) { cancelled = true; task?.cancel(); } });
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
      if (!['processing', 'pending_review', 'published'].includes(initialized.status)) {
        const response = await fetch(draft.localUri); const blob = await response.blob(); check();
        if (blob.size <= 0 || blob.size > initialized.maxUploadBytes) throw new Error('clip-file-too-large');
        draft = await saveClipDraft({ ...draft, status: 'uploading' });
        task = uploadBytesResumable(ref(storage, initialized.storagePath), blob, { contentType: draft.mimeType });
        if (manualPause || networkPause) task.pause();
        await new Promise<void>((resolve, reject) => task!.on('state_changed', snapshot => {
          callbacks.onProgress?.({ transferredBytes: snapshot.bytesTransferred, totalBytes: snapshot.totalBytes,
            progress: snapshot.bytesTransferred / Math.max(1, snapshot.totalBytes), state: snapshot.state === 'paused' ? 'paused' : 'running' });
        }, reject, resolve));
        check(); draft = await saveClipDraft({ ...draft, status: 'uploaded' });
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
      if (auth.currentUser?.uid === uid) await saveClipDraft({ ...draft, status: cancelled ? 'draft' : 'failed',
        errorCode: cancelled ? undefined : (error instanceof Error ? error.message : 'clip-upload-failed') }).catch(() => {});
      throw error;
    } finally { stopAuth(); stopNetwork(); }
  })();
  return { done,
    pause() { manualPause = true; task?.pause(); progress('paused'); },
    resume() { manualPause = false; if (!networkPause) task?.resume(); progress(networkPause ? 'paused' : 'running'); },
    cancel() { cancelled = true; task?.cancel(); },
  };
}
