import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { subscribeConversations } from '../lib/conversations';

// Number of conversations with at least one unread message. Sourced once
// here so the Chats tab badge and the "Unread" filter chip always agree.
const UnreadContext = createContext<{ unreadChats: number }>({ unreadChats: 0 });

export const useUnread = () => useContext(UnreadContext);

export function UnreadProvider({ children }: { children: React.ReactNode }) {
  const me = auth.currentUser?.uid;
  const [counts, setCounts] = useState<Record<string, number>>({});
  const subsRef = useRef<Record<string, () => void>>({});

  useEffect(() => {
    if (!me) { setCounts({}); return; }
    const unsubConvos = subscribeConversations(rows => {
      const ids = new Set(rows.map(r => r.id));
      // Drop listeners + counts for conversations that are gone.
      for (const id of Object.keys(subsRef.current)) {
        if (!ids.has(id)) {
          try { subsRef.current[id](); } catch {}
          delete subsRef.current[id];
          setCounts(prev => { const next = { ...prev }; delete next[id]; return next; });
        }
      }
      // Subscribe each newly seen conversation's per-user unread count.
      for (const r of rows) {
        if (subsRef.current[r.id]) continue;
        subsRef.current[r.id] = onSnapshot(doc(db, 'conversations', r.id, 'userState', me), snap => {
          const n = (snap.data()?.unreadCount as number | undefined) ?? 0;
          setCounts(prev => (prev[r.id] === n ? prev : { ...prev, [r.id]: n }));
        });
      }
    });
    return () => {
      unsubConvos();
      for (const id of Object.keys(subsRef.current)) { try { subsRef.current[id](); } catch {} }
      subsRef.current = {};
    };
  }, [me]);

  const unreadChats = Object.values(counts).filter(n => n > 0).length;
  return <UnreadContext.Provider value={{ unreadChats }}>{children}</UnreadContext.Provider>;
}
