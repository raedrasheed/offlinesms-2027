import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { sanitizePoll, type PollData } from '../lib/pollModel';
import { getCurrentUid, getDb } from '../localdb/connection';
import { applyRemoteMessages } from '../localdb/repositories/messagesRepo';
import { remoteMessageInput } from '../localdb/sync/remoteMessage';

type Status = 'loading' | 'ready' | 'error' | 'unavailable';

/** The chat feed only watches its newest window. Older polls need their own
 * subscription while results are open; otherwise cached votes look complete
 * but silently omit every vote cast after the poll left that window. */
export function usePollResults(cached: PollData, cid?: string, mid?: string, uid?: string) {
  const key = JSON.stringify([cid, mid, uid]);
  const [retryCount, setRetryCount] = useState(0);
  const [state, setState] = useState<{ key: string; poll?: PollData; status: Status }>({ key: '', status: 'loading' });
  useEffect(() => {
    if (!cid || !mid || !uid) return;
    let active = true;
    let writes = Promise.resolve();
    const local = getCurrentUid() === uid ? getDb() : null;
    const current = () => active && auth.currentUser?.uid === uid;
    setState(previous => ({ key, poll: previous.key === key ? previous.poll : undefined, status: 'loading' }));
    const stop = onSnapshot(doc(db, 'conversations', cid, 'messages', mid), { includeMetadataChanges: true }, snapshot => {
      if (!current()) return;
      // An empty offline cache is not proof the poll was deleted.
      if (!snapshot.exists() && snapshot.metadata.fromCache) return;
      const message = snapshot.data();
      if (!snapshot.exists() || message?.type !== 'poll' || !message.poll || message.deletedForEveryone) {
        setState({ key, status: 'unavailable' });
        return;
      }
      const poll = sanitizePoll(message.poll);
      setState({ key, poll, status: snapshot.metadata.fromCache ? 'loading' : 'ready' });
      // Persist ordered server snapshots so closing the sheet also updates an
      // old poll's bubble and its cached results for the next offline open.
      if (!snapshot.metadata.fromCache && local) writes = writes.then(async () => {
        if (current() && getCurrentUid() === uid && getDb() === local) {
          await applyRemoteMessages([remoteMessageInput(mid, cid, message)]);
        }
      }).catch(() => {});
    }, error => {
      if (!current()) return;
      const forbidden = ['permission-denied', 'not-found'].includes(error.code);
      setState(previous => ({ key, poll: forbidden ? undefined : previous.key === key ? previous.poll : undefined,
        status: forbidden ? 'unavailable' : 'error' }));
    });
    return () => { active = false; stop(); };
  }, [key, cid, mid, uid, retryCount]);
  const result = state.key === key ? state : { status: cid && mid && uid ? 'loading' as const : 'ready' as const };
  return { poll: result.status === 'unavailable' ? null : ('poll' in result ? result.poll : undefined) ?? cached,
    status: result.status, retry: () => setRetryCount(n => n + 1) };
}
