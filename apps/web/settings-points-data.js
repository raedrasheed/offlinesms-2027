import { canonicaliseType } from '../mobile/src/lib/points.helpers.ts';

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function pick(data, keys) {
  return Object.fromEntries(keys.filter(key => data[key] != null).map(key => [key, data[key]]));
}

function transaction(snapshot) {
  const item = snapshot.data();
  const type = canonicaliseType(item.type);
  const amount = Number.isSafeInteger(item.amount) ? item.amount : 0;
  const direction = item.direction === 'credit' || item.direction === 'debit' ? item.direction
    : amount < 0 || (amount === 0 && ['sms_spend', 'reservation', 'transfer_out'].includes(type)) ? 'debit' : 'credit';
  return {
    ...pick(item, ['relatedTransferId', 'note', 'createdAt', 'completedAt', 'sent', 'failed', 'refund']),
    id: snapshot.id,
    type,
    status: item.status ?? 'completed',
    direction,
    amount: Math.abs(amount),
    relatedSmsBatchId: item.batchId ?? item.relatedSmsBatchId,
    relatedUserId: item.peerId ?? item.relatedUserId,
  };
}

export function createSettingsPointsData({ sdk, db, watchScoped, documentId, requireSession }) {
  const rows = (uid, source, map, onValue, onError) => watchScoped(uid, source, snapshot => onValue(snapshot.docs.map(map)), onError);

  return {
    watchPointsWallet(uid, onValue, onError) {
      const source = sdk.doc(db, 'wallets', documentId(uid));
      return watchScoped(uid, source, snapshot => {
        const data = snapshot.data() ?? {};
        const balance = count(data.balance);
        const reserved = count(data.reserved);
        onValue({ balance, reserved, available: Math.max(0, balance - reserved), status: data.status ?? 'active' });
      }, onError);
    },
    watchPointsTransactions(uid, onValue, onError) {
      const source = sdk.query(sdk.collection(db, 'transactions'), sdk.where('userId', '==', uid),
        sdk.orderBy('createdAt', 'desc'), sdk.limit(25));
      return rows(uid, source, transaction, onValue, onError);
    },
    watchPointsPackages(uid, onValue, onError) {
      const source = sdk.query(sdk.collection(db, 'pointsPackages'), sdk.where('status', '==', 'active'),
        sdk.orderBy('sortOrder', 'asc'), sdk.limit(20));
      return rows(uid, source, snapshot => {
        const data = snapshot.data();
        return { id: snapshot.id, name: typeof data.name === 'string' ? data.name : '', points: count(data.points) };
      }, items => onValue(items.filter(item => item.points > 0)), onError);
    },
    watchPointsRequests(uid, onValue, onError) {
      const source = sdk.query(sdk.collection(db, 'pointsRequests'), sdk.where('userId', '==', uid), sdk.limit(50));
      return rows(uid, source, snapshot => ({ id: snapshot.id,
        ...pick(snapshot.data(), ['packageName', 'points', 'status', 'createdAt', 'reviewedAt', 'reviewNote']) }), items => {
        onValue(items.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)));
      }, onError);
    },
    async searchPointsRecipients(uid, value) {
      requireSession(uid);
      const prefix = value.trim().replace(/^@/, '').toLowerCase();
      if (!/^[a-z0-9][a-z0-9._]{0,19}$/.test(prefix)) return [];
      const source = sdk.query(sdk.collection(db, 'users'), sdk.orderBy('usernameLower'),
        sdk.where('usernameLower', '>=', prefix), sdk.where('usernameLower', '<=', `${prefix}\uf8ff`), sdk.limit(20));
      const snapshot = await sdk.getDocsFromServer(source);
      requireSession(uid);
      return snapshot.docs.flatMap(doc => {
        const data = doc.data();
        if (doc.id === uid || (data.status ?? 'active') !== 'active' || typeof data.username !== 'string') return [];
        return [{ uid: doc.id, username: data.username, displayName: typeof data.displayName === 'string' ? data.displayName : '' }];
      });
    },
    watchPointsSmsBatch(uid, batchId, onValue, onError) {
      const source = sdk.doc(db, 'smsBatches', documentId(batchId));
      return watchScoped(uid, source, snapshot => {
        const data = snapshot.data();
        onValue(data ? { id: snapshot.id,
          ...pick(data, ['status', 'offlineSmsBatchId', 'gatewayBatchId', 'audience', 'audienceCanonical',
            'attemptNumber', 'createdAt', 'updatedAt', 'lastDeliveryReportAt', 'pointsReserved', 'pointsDeducted', 'pointsRefunded']) }
          : null);
      }, onError);
    },
    watchPointsSmsRecipients(uid, batchId, onValue, onError) {
      const source = sdk.collection(db, 'smsBatches', documentId(batchId), 'recipients');
      return rows(uid, source, snapshot => ({ uid: snapshot.id,
        ...pick(snapshot.data(), ['maskedPhone', 'smsStatus', 'skipReason', 'sentAt', 'deliveredAt', 'failedAt']) }), onValue, onError);
    },
  };
}
