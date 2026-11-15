export const TICKET_CATEGORIES = ['billing', 'technical', 'account', 'other'];

export function createSettingsSupportClient({ sdk, db, auth, watchScoped, requireSession, invoke }) {
  const tickets = () => sdk.collection(db, 'tickets');

  return {
    watchSupportTickets(uid, onTickets, onError) {
      const source = sdk.query(tickets(), sdk.where('createdBy', '==', uid), sdk.orderBy('createdAt', 'desc'));
      return watchScoped(uid, source, snapshot => {
        onTickets(snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            subject: typeof data.subject === 'string' ? data.subject : '',
            category: data.category ?? 'other',
            status: data.status ?? 'open',
            createdAt: data.createdAt?.toDate?.() ?? null,
          };
        }));
      }, onError);
    },

    async createSupportTicket(uid, { subject, description, category }) {
      requireSession(uid);
      const title = typeof subject === 'string' ? subject.trim() : '';
      const details = typeof description === 'string' ? description.trim() : '';
      if (!title || title.length > 120 || !details || details.length > 2000 || !TICKET_CATEGORIES.includes(category)) {
        throw new Error('support-ticket-invalid');
      }
      const ref = await sdk.addDoc(tickets(), {
        subject: title,
        description: details,
        category,
        status: 'open',
        createdBy: uid,
        createdAt: sdk.serverTimestamp(),
        updatedAt: sdk.serverTimestamp(),
      });
      requireSession(uid);
      return ref.id;
    },

    async deleteOwnAccount(uid) {
      requireSession(uid);
      const outcome = await invoke('deleteMyAccount', { expectedUid: uid });
      if (outcome?.ok !== true) throw new Error('account-deletion-unconfirmed');

      // The callable already committed. Local sign-out failure is a separate outcome.
      if (auth.currentUser?.uid === uid) {
        try { await sdk.signOut(auth); } catch { /* The account has been deleted. */ }
      }
      return { signedOut: auth.currentUser?.uid !== uid };
    },
  };
}
