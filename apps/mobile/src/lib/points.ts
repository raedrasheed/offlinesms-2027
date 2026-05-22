// OfflineSMS Points wallet + transaction data layer.
//
// Read-only: clients don't mutate wallet balances or transactions
// directly. The mobile screens consume these subscriptions; backend
// writers (Phase 0 buyPoints / transferPoints / Phase 8
// onSmsBatchAccepted) own all writes via the Admin SDK.

import {
  collection, doc, getDoc, limit, onSnapshot, orderBy, query, where,
} from 'firebase/firestore';
import { db } from './firebase';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type CanonicalType =
  | 'sms_spend'
  | 'reservation'
  | 'reservation_release'
  | 'refund'
  | 'purchase'
  | 'transfer_in'
  | 'transfer_out'
  | 'admin_adjustment'
  | 'other';

export type TransactionDirection = 'credit' | 'debit';
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'reversed' | 'refunded';

export type Wallet = {
  uid:       string;
  balance:   number;
  reserved:  number;
  available: number;
  createdAt?: any;
  updatedAt?: any;
};

export type Transaction = {
  id:                    string;
  userId:                string;
  type:                  CanonicalType;
  rawType:               string;                  // original Firestore value
  direction:             TransactionDirection;
  amount:                number;                  // absolute value, always >= 0
  rawAmount:             number;                  // original signed value
  status:                TransactionStatus;
  package?:              string | null;
  relatedSmsBatchId?:    string | null;
  relatedMessageId?:     string | null;
  relatedConversationId?: string | null;
  relatedUserId?:        string | null;
  refund?:               number;
  sent?:                 number;
  failed?:               number;
  priceCents?:           number;
  note?:                 string | null;
  createdAt:             any;
  completedAt?:          any;
};

// ─────────────────────────────────────────────────────────────────
// Canonical mapping
// ─────────────────────────────────────────────────────────────────

/** Convert any backend-written type string to the canonical Phase 9 name. */
export function canonicaliseType(raw: string | undefined | null): CanonicalType {
  switch (raw) {
    case 'sms_spend':
    case 'sms':              return 'sms_spend';

    case 'reservation':      return 'reservation';
    case 'reservation_release':
    case 'release':          return 'reservation_release';

    case 'refund':           return 'refund';

    case 'purchase':
    case 'buy':              return 'purchase';

    case 'transfer_in':
    case 'transfer-in':      return 'transfer_in';

    case 'transfer_out':
    case 'transfer-out':     return 'transfer_out';

    case 'admin_adjustment':
    case 'admin-adjust':
    case 'admin_adjust':     return 'admin_adjustment';

    default:                 return 'other';
  }
}

/** Direction implied by canonical type, unless the doc carries one. */
function directionFor(type: CanonicalType, rawAmount: number): TransactionDirection {
  if (rawAmount < 0) return 'debit';
  if (rawAmount > 0) return 'credit';
  switch (type) {
    case 'sms_spend':
    case 'reservation':
    case 'transfer_out':       return 'debit';
    case 'reservation_release':
    case 'refund':
    case 'purchase':
    case 'transfer_in':        return 'credit';
    case 'admin_adjustment':
    case 'other':              return rawAmount < 0 ? 'debit' : 'credit';
  }
}

/** UI label, English. i18n keys are namespaced separately. */
export function getTransactionLabel(type: CanonicalType): string {
  switch (type) {
    case 'sms_spend':            return 'SMS spending';
    case 'reservation':          return 'Reservation';
    case 'reservation_release':  return 'Reservation released';
    case 'refund':               return 'Refund';
    case 'purchase':             return 'Purchase';
    case 'transfer_in':          return 'Transfer in';
    case 'transfer_out':         return 'Transfer out';
    case 'admin_adjustment':     return 'Admin adjustment';
    case 'other':                return 'Adjustment';
  }
}

export function getTransactionIcon(type: CanonicalType): string {
  switch (type) {
    case 'sms_spend':            return '✉︎';
    case 'reservation':          return '⏳';
    case 'reservation_release':  return '↺';
    case 'refund':               return '↩︎';
    case 'purchase':             return '＋';
    case 'transfer_in':          return '↙︎';
    case 'transfer_out':         return '↗︎';
    case 'admin_adjustment':     return '◆';
    case 'other':                return '•';
  }
}

/** Format a transaction amount with leading sign per its direction. */
export function formatPointsAmount(amount: number, direction: TransactionDirection): string {
  const abs = Math.abs(amount).toLocaleString();
  return (direction === 'credit' ? '+' : '−') + abs + ' pts';
}

// ─────────────────────────────────────────────────────────────────
// Read subscriptions
// ─────────────────────────────────────────────────────────────────

export function subscribeWallet(uid: string, cb: (wallet: Wallet | null) => void) {
  if (!uid) { cb(null); return () => {}; }
  return onSnapshot(doc(db, 'wallets', uid), snap => {
    if (!snap.exists()) {
      cb({ uid, balance: 0, reserved: 0, available: 0 });
      return;
    }
    const data = snap.data() as { balance?: number; reserved?: number; createdAt?: any; updatedAt?: any };
    const balance  = data.balance  ?? 0;
    const reserved = data.reserved ?? 0;
    cb({ uid, balance, reserved, available: Math.max(0, balance), createdAt: data.createdAt, updatedAt: data.updatedAt });
  });
}

function fromSnap(id: string, raw: Record<string, unknown>): Transaction {
  const rawType   = (raw.type as string | undefined) ?? 'other';
  const rawAmount = (raw.amount as number | undefined) ?? 0;
  const type = canonicaliseType(rawType);
  const direction = (raw.direction as TransactionDirection | undefined) ?? directionFor(type, rawAmount);
  const status = ((raw.status as string | undefined) ?? 'completed') as TransactionStatus;

  return {
    id,
    userId:                (raw.userId as string) ?? '',
    type,
    rawType,
    direction,
    amount:                Math.abs(rawAmount),
    rawAmount,
    status,
    package:               (raw.package as string | null | undefined) ?? null,
    relatedSmsBatchId:     (raw.batchId as string | undefined) ?? (raw.relatedSmsBatchId as string | undefined) ?? null,
    relatedMessageId:      (raw.relatedMessageId as string | undefined) ?? null,
    relatedConversationId: (raw.relatedConversationId as string | undefined) ?? null,
    relatedUserId:         (raw.peerId as string | undefined) ?? (raw.relatedUserId as string | undefined) ?? null,
    refund:                (raw.refund as number | undefined) ?? undefined,
    sent:                  (raw.sent as number | undefined) ?? undefined,
    failed:                (raw.failed as number | undefined) ?? undefined,
    priceCents:            (raw.priceCents as number | undefined) ?? undefined,
    note:                  (raw.note as string | undefined) ?? null,
    createdAt:             raw.createdAt ?? null,
    completedAt:           raw.completedAt ?? null,
  };
}

export function subscribeTransactions(
  uid: string,
  cb: (rows: Transaction[]) => void,
  opts?: { limit?: number; type?: CanonicalType | null },
) {
  if (!uid) { cb([]); return () => {}; }
  const n = opts?.limit ?? 25;
  // Map canonical → raw type for the where filter.
  const rawTypes = opts?.type ? rawTypesFor(opts.type) : null;
  if (rawTypes && rawTypes.length === 1) {
    const q = query(
      collection(db, 'transactions'),
      where('userId', '==', uid),
      where('type',   '==', rawTypes[0]),
      orderBy('createdAt', 'desc'),
      limit(n),
    );
    return onSnapshot(q, snap => cb(snap.docs.map(d => fromSnap(d.id, d.data())) ));
  }
  // No filter (or multi-value filter — Firestore needs an 'in' query and an
  // index; for Phase 9 we fall back to client-side filtering of the
  // unfiltered stream when the canonical maps to >1 legacy value).
  const q = query(
    collection(db, 'transactions'),
    where('userId', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(n * 2),
  );
  return onSnapshot(q, snap => {
    const rows = snap.docs.map(d => fromSnap(d.id, d.data()));
    const filtered = rawTypes
      ? rows.filter(t => rawTypes.includes(t.rawType)).slice(0, n)
      : rows.slice(0, n);
    cb(filtered);
  });
}

/** Inverse of canonicaliseType — used by the type-filter query. */
function rawTypesFor(type: CanonicalType): string[] {
  switch (type) {
    case 'sms_spend':           return ['sms_spend', 'sms'];
    case 'reservation':         return ['reservation'];
    case 'reservation_release': return ['reservation_release', 'release'];
    case 'refund':              return ['refund'];
    case 'purchase':            return ['purchase', 'buy'];
    case 'transfer_in':         return ['transfer_in', 'transfer-in'];
    case 'transfer_out':        return ['transfer_out', 'transfer-out'];
    case 'admin_adjustment':    return ['admin_adjustment', 'admin-adjust', 'admin_adjust'];
    case 'other':               return [];
  }
}

export async function getTransaction(transactionId: string): Promise<Transaction | null> {
  const snap = await getDoc(doc(db, 'transactions', transactionId));
  if (!snap.exists()) return null;
  return fromSnap(snap.id, snap.data());
}
