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
import {
  canonicaliseType,
  getTransactionLabel,
  getTransactionIcon,
  formatPointsAmount,
  type CanonicalType,
  type TransactionDirection,
} from './points.helpers';

// Re-export the pure helpers so existing imports keep working.
export {
  canonicaliseType,
  getTransactionLabel,
  getTransactionIcon,
  formatPointsAmount,
};
export type { CanonicalType, TransactionDirection };

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
  relatedPaymentId?:     string | null;
  relatedTransferId?:    string | null;
  refund?:               number;
  sent?:                 number;
  failed?:               number;
  priceCents?:           number;
  note?:                 string | null;
  createdAt:             any;
  completedAt?:          any;
};

// ─────────────────────────────────────────────────────────────────
// Direction inference (kept local — points.ts uses it for fromSnap)
// ─────────────────────────────────────────────────────────────────

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
    relatedPaymentId:      (raw.relatedPaymentId as string | undefined) ?? null,
    relatedTransferId:     (raw.relatedTransferId as string | undefined) ?? null,
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

// ─────────────────────────────────────────────────────────────────
// Points packages (READ-ONLY, informational).
//
// The mobile app does NOT sell points — there is no price, currency,
// purchase, checkout, or payment. This read-only list shows the point
// bundles an organization/admin can assign, so users know what to request.
// Only the package name and point amount are exposed; price/bonus/currency
// are intentionally NOT read or surfaced.
// ─────────────────────────────────────────────────────────────────

export type PointsPackage = {
  id:        string;
  name:      string;
  points:    number;
  sortOrder: number;
};

export function subscribePackages(cb: (rows: PointsPackage[]) => void) {
  const q = query(
    collection(db, 'pointsPackages'),
    where('status', '==', 'active'),
    orderBy('sortOrder', 'asc'),
    limit(20),
  );
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => {
      const data = d.data() as { name?: string; points?: number; sortOrder?: number };
      return {
        id:        d.id,
        name:      data.name ?? '',
        points:    data.points ?? 0,
        sortOrder: data.sortOrder ?? 0,
      };
    }));
  }, err => {
    console.warn('[points] subscribePackages failed:', err);
    cb([]);
  });
}

// ─────────────────────────────────────────────────────────────────
// Transfers (callable wrapper). NOTE: points are NOT sold in the mobile
// app — there is no purchase / package / payment flow. Points are assigned
// by an organization or OfflineSMS admin. Transfers move existing points
// between users and never involve buying.
// ─────────────────────────────────────────────────────────────────

import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase';

export type TransferResult = {
  transferId: string;
  amount:     number;
  flagged:    boolean;
};

function callable<T = unknown, R = unknown>(name: string) {
  return httpsCallable<T, R>(getFunctions(app), name);
}

export async function transferPoints(args: {
  recipientUid: string;
  amount: number;
  note?: string;
}): Promise<TransferResult> {
  const res = await callable<typeof args, TransferResult>('transferPoints')(args);
  return res.data;
}

export type PointsRequestResult = {
  requestId:   string;
  status:      'pending';
  points:      number;
  packageName: string;
};

/**
 * Ask an org / OfflineSMS admin to assign a points package. NOT a purchase:
 * no price, currency, or payment — creates a pending pointsRequests doc the
 * admin approves (credits) or rejects from the dashboard.
 */
export async function createPointsRequest(packageId: string, note?: string): Promise<PointsRequestResult> {
  const res = await callable<{ packageId: string; note?: string }, PointsRequestResult>(
    'createPointsRequest',
  )({ packageId, ...(note ? { note } : {}) });
  return res.data;
}

export function pointsErrorReason(err: unknown): string | null {
  const msg = (err as { message?: string })?.message ?? '';
  if (!msg) return null;
  return msg.includes(':') ? msg.split(':')[0] : msg;
}

export function pointsErrorCopy(code: string, reason?: string | null): string {
  if (reason) {
    switch (reason) {
      case 'self-transfer':            return 'You can’t transfer points to yourself.';
      case 'insufficient-balance':     return 'Not enough OfflineSMS Points.';
      case 'daily-cap-count-reached':  return 'Daily transfer limit reached.';
      case 'daily-cap-points-reached': return 'Daily transfer points limit reached.';
      case 'wallet-frozen':            return 'Your OfflineSMS Points wallet is frozen.';
      case 'wallet-closed':            return 'Your OfflineSMS Points wallet is closed.';
      case 'recipient-wallet-frozen':  return 'The recipient’s wallet is frozen.';
      case 'recipient-not-found':      return 'Recipient not found.';
    }
  }
  switch (code) {
    case 'functions/resource-exhausted':
    case 'resource-exhausted':
      return 'Daily limit reached. Try again tomorrow.';
    case 'functions/permission-denied':
    case 'permission-denied':
      return 'You don’t have permission for this action.';
    case 'functions/failed-precondition':
    case 'failed-precondition':
      return 'This action isn’t available right now.';
    case 'functions/invalid-argument':
    case 'invalid-argument':
      return 'Please review the values and try again.';
    case 'functions/not-found':
    case 'not-found':
      return 'Not found.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
