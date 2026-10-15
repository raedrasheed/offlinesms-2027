// Foreground reads must not wait for the realtime WebChannel to connect/retry.
// Firestore Lite uses authenticated REST RPCs on the SAME Firebase app. The
// full SDK continues to own realtime listeners; SQLite owns offline storage.
import { collection, query, orderBy, limit, doc, getDoc, getDocs, getFirestore, connectFirestoreEmulator } from 'firebase/firestore/lite';
import { app } from '../../lib/firebase';
import { remoteMessageInput } from './remoteMessage';
import { perfMark, perfNow } from '../../lib/perf';

const readDb = getFirestore(app);
if (process.env.EXPO_PUBLIC_USE_EMULATORS === '1') connectFirestoreEmulator(readDb, 'localhost', 8080);

export const RECENT_MESSAGE_LIMIT = 25;

export async function readRecentMessages(conversationId: string) {
  const started = perfNow();
  try {
    const snap = await getDocs(query(collection(readDb, 'conversations', conversationId, 'messages'),
      orderBy('createdAt', 'desc'), limit(RECENT_MESSAGE_LIMIT)));
    perfMark('sync:recent:network', { durationMs: Math.round(perfNow() - started), count: snap.size });
    return snap.docs.map(d => remoteMessageInput(d.id, conversationId, d.data()));
  } catch (error) {
    perfMark('sync:recent:error', { durationMs: Math.round(perfNow() - started) });
    throw error;
  }
}

export async function readMessageById(conversationId: string, messageId: string) {
  const started = perfNow();
  const snap = await getDoc(doc(readDb, 'conversations', conversationId, 'messages', messageId));
  perfMark('sync:target:network', { durationMs: Math.round(perfNow() - started), found: snap.exists() });
  return snap.exists() ? remoteMessageInput(snap.id, conversationId, snap.data()) : null;
}
