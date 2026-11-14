function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function messageReceiptTotals(receipts) {
  // Current viewed totals include reads. Older messages may only have a read count.
  const seen = Math.max(count(receipts.readCount), count(receipts.viewedCount)) + count(receipts.playedCount);
  return {
    delivered: Math.max(count(receipts.deliveredCount), seen),
    seen,
    pending: count(receipts.pendingCount),
    failed: count(receipts.failedCount),
  };
}
