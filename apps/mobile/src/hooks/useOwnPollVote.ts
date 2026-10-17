import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db as firestore } from '../lib/firebase';
import { getCurrentUid, getDb } from '../localdb/connection';
import { onLocalMessagesChanged } from '../localdb/messageChanges';
import { readOwnPollVote, saveOwnPollVote, UNKNOWN_POLL_VOTE, type OwnPollVote } from '../localdb/pollVote';

/** Only the signed-in member's document is listened to. A missing cached
 * snapshot is NOT proof of no vote: wait for the server or a known local ballot. */
export function useOwnPollVote(cid: string | undefined, mid: string | undefined, uid: string, enabled: boolean): OwnPollVote {
  const key = JSON.stringify([enabled, cid, mid, uid]);
  const [state, setState] = useState({ key: '', vote: UNKNOWN_POLL_VOTE });
  useEffect(() => {
    if (!enabled || !cid || !mid || !uid) return;
    let active = true;
    let generation = 0;
    const local = getCurrentUid() === uid ? getDb() : null;
    const refresh = async () => {
      const version = ++generation;
      if (!local) return;
      try {
        const vote = await readOwnPollVote(local, cid, mid);
        if (active && version === generation && getCurrentUid() === uid) setState({ key, vote });
      } catch { /* retain the last known selection while the account closes */ }
    };
    void refresh();
    const stopLocal = onLocalMessagesChanged(changed => { if (changed === cid) void refresh(); });
    const stopRemote = onSnapshot(doc(firestore, 'conversations', cid, 'messages', mid, 'pollVoters', uid),
      { includeMetadataChanges: true }, snapshot => {
        if (!active || (!snapshot.exists() && snapshot.metadata.fromCache)) return;
        const data = snapshot.data();
        const selection = Array.isArray(data?.optionIds) ? data.optionIds.filter((id: unknown) => typeof id === 'string') : [];
        const seq = typeof data?.seq === 'number' ? data.seq : 0;
        if (local && getCurrentUid() === uid) {
          void saveOwnPollVote(local, cid, mid, selection, seq).catch(() => {});
        } else if (!local) {
          setState(previous => previous.key === key && previous.vote.seq > seq ? previous :
            { key, vote: { known: true, selection, seq, pending: false, failed: false } });
        }
      }, () => { /* Unknown stays disabled; cached ballots remain available offline. */ });
    return () => { active = false; ++generation; stopLocal(); stopRemote(); };
  }, [key, enabled, cid, mid, uid]);
  return state.key === key ? state.vote : UNKNOWN_POLL_VOTE;
}
