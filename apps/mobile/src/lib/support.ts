import { collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export type TicketCategory = 'billing' | 'technical' | 'account' | 'other';

export type SupportTicket = {
  id: string;
  subject: string;
  description: string;
  category: TicketCategory;
  status: 'open' | 'pending' | 'resolved' | 'closed';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export async function createSupportTicket(params: {
  uid: string;
  subject: string;
  description: string;
  category: TicketCategory;
}): Promise<string> {
  const { subject, description, category, uid } = params;
  if (!subject.trim()) throw new Error('Subject is required.');
  if (!description.trim()) throw new Error('Description is required.');

  const ref = await addDoc(collection(db, 'tickets'), {
    subject:     subject.trim(),
    description: description.trim(),
    category,
    status:      'open',
    createdBy:   uid,
    createdAt:   serverTimestamp(),
    updatedAt:   serverTimestamp(),
  });
  return ref.id;
}

export function subscribeMyTickets(
  uid: string,
  cb: (tickets: SupportTicket[]) => void,
): () => void {
  const q = query(
    collection(db, 'tickets'),
    where('createdBy', '==', uid),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => {
      const data = d.data();
      const ts = (t: any) => t?.toDate?.()?.toLocaleString('en-US', {
        month: 'short', day: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }) ?? '—';
      return {
        id:          d.id,
        subject:     data.subject ?? '',
        description: data.description ?? '',
        category:    data.category ?? 'other',
        status:      data.status ?? 'open',
        createdBy:   data.createdBy ?? uid,
        createdAt:   ts(data.createdAt),
        updatedAt:   ts(data.updatedAt),
      };
    }));
  });
}
