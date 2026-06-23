// Pure helpers extracted from points.ts so they can be unit-tested
// without pulling in firebase. points.ts re-exports them.

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

/** UI label, English. i18n keys are namespaced separately. */
export function getTransactionLabel(type: CanonicalType): string {
  switch (type) {
    case 'sms_spend':            return 'SMS spending';
    case 'reservation':          return 'Reservation';
    case 'reservation_release':  return 'Reservation released';
    case 'refund':               return 'Refund';
    case 'purchase':             return 'Points added';
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
