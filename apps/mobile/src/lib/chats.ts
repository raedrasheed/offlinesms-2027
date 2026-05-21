// Firestore queries for chats and messages
import {
  collection, doc, onSnapshot, orderBy, query, where, addDoc, serverTimestamp, limit,
} from 'firebase/firestore';
import { db, auth } from './firebase';

export type Conversation = {
  id: string;
  type: 'dm' | 'group' | 'channel';
  name?: string;
  memberIds: string[];
  lastMessageText?: string;
  lastMessageAt?: any;
  unreadCount?: number;
  pinned?: boolean;
  muted?: boolean;
};

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  type: 'text' | 'image' | 'audio' | 'file' | 'location' | 'poll' | 'system';
  text?: string;
  mediaUrl?: string;
  createdAt: any;
  deliveredTo?: string[];
  readBy?: string[];
};

export function subscribeConversations(cb: (rows: Conversation[]) => void) {
  const uid = auth.currentUser?.uid;
  if (!uid) return () => {};
  const q = query(
    collection(db, 'conversations'),
    where('memberIds', 'array-contains', uid),
    orderBy('lastMessageAt', 'desc'),
    limit(50),
  );
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Conversation[]));
}

export function subscribeMessages(convoId: string, cb: (msgs: Message[]) => void) {
  const q = query(
    collection(db, 'conversations', convoId, 'messages'),
    orderBy('createdAt', 'desc'),
    limit(100),
  );
  return onSnapshot(q, snap => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Message[];
    cb(rows.reverse());
  });
}

export async function sendText(convoId: string, text: string) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  await addDoc(collection(db, 'conversations', convoId, 'messages'), {
    senderId: uid,
    type: 'text',
    text,
    createdAt: serverTimestamp(),
  });
  // The Cloud Function 'onMessageCreate' updates conversation lastMessage* and fan-outs receipts.
}
