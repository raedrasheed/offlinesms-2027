import { auth } from './firebase';
import { getClip } from './clips';
import { getClipDraft, saveClipDraft, type ClipDraft } from './clipDrafts';

/** A transport failure is not a processing failure. Unlock retry only after
 * the server explicitly confirms failure, retaining the same upload identity. */
export async function reconcileClipDraftStatus(draft: ClipDraft): Promise<ClipDraft> {
  if (draft.status !== 'processing' || !draft.clipId || auth.currentUser?.uid !== draft.uid) return draft;
  try {
    const remote = await getClip(draft.clipId);
    if (remote.status !== 'failed' || auth.currentUser?.uid !== draft.uid) return draft;
    const latest = await getClipDraft(draft.id);
    if (!latest || latest.uid !== draft.uid || latest.clipId !== draft.clipId || latest.status !== 'processing' || auth.currentUser?.uid !== draft.uid) return latest ?? draft;
    return await saveClipDraft({ ...latest, status: 'failed', errorCode: 'clip-processing-failed' });
  } catch { return draft; }
}
