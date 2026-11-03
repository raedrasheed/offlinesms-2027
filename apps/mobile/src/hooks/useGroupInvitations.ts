import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
export type GroupInvitation = { id: string; groupName: string; inviterUid: string };
export function useGroupInvitations() {
  const uid = auth.currentUser?.uid;
  const [items, setItems] = useState<GroupInvitation[]>([]), [error, setError] = useState(false), [loading, setLoading] = useState(true);
  useEffect(() => {
    setItems([]); setError(false); setLoading(true);
    if (!uid) { setLoading(false); return; }
    return onSnapshot(query(collection(db, 'users', uid, 'groupInvitations'), where('status', '==', 'pending')), snapshot => {
      setItems(snapshot.docs.map(d => ({ id: d.id, groupName: d.data().groupName, inviterUid: d.data().inviterUid }))); setLoading(false); setError(false);
    }, () => { setError(true); setLoading(false); });
  }, [uid]);
  return { items, error, loading };
}
