export const RECEIPT_FIELDS = ['deliveredCount', 'readCount', 'viewedCount', 'playedCount', 'failedCount', 'pendingCount'] as const;
export type ReceiptCounts = Record<typeof RECEIPT_FIELDS[number], number>;
export function receiptCounts(status: unknown): ReceiptCounts {
  return {
    deliveredCount: ['delivered', 'read', 'viewed', 'played'].includes(String(status)) ? 1 : 0,
    readCount: status === 'read' ? 1 : 0,
    viewedCount: status === 'read' || status === 'viewed' ? 1 : 0,
    playedCount: status === 'played' ? 1 : 0,
    failedCount: status === 'failed' ? 1 : 0,
    pendingCount: status === 'pending' ? 1 : 0,
  };
}
