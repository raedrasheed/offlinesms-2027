const delivered = 1;
const read = 2;
const readDelay = 150;
const concurrentLimit = 2;
const rememberedLimit = 1000;

export function createChatReceipts({ viewport, flow, canRead, send }) {
  const acknowledged = new Map();
  let thread;
  let busy = 0;
  let readTimer;
  let sendTimer;

  function stop() {
    thread = undefined;
    clearTimeout(readTimer);
    clearTimeout(sendTimer);
  }

  function reset() {
    stop();
    acknowledged.clear();
  }

  function remember(key, status) {
    acknowledged.delete(key);
    acknowledged.set(key, status);
    if (acknowledged.size > rememberedLimit) acknowledged.delete(acknowledged.keys().next().value);
  }

  function flush() {
    clearTimeout(sendTimer);
    const scope = thread;
    if (!scope) return;
    const now = performance.now();
    let earliest = Infinity;
    const work = [...scope.records.values()].sort((a, b) => b.target - a.target);
    for (const record of work) {
      if (busy >= concurrentLimit) break;
      if (!record.received || record.inFlight || record.target <= record.ack || record.failures >= 3) continue;
      if (record.retryAt > now) { earliest = Math.min(earliest, record.retryAt); continue; }
      const level = record.target;
      busy++;
      record.inFlight = true;
      void send({ conversationId: scope.id, recipientUid: scope.uid, messageId: record.id,
        status: level === read ? 'read' : 'delivered' }).then(() => {
        if (scope !== thread) return;
        record.ack = level;
        record.failures = 0;
        remember(record.key, level);
      }).catch((error) => {
        if (scope !== thread || record.target > level) return;
        const terminal = /(?:permission-denied|unauthenticated|not-found|invalid-argument|failed-precondition)$/.test(error?.code ?? '');
        record.failures = terminal ? 3 : record.failures + 1;
        record.retryAt = performance.now() + record.failures * 800;
      }).finally(() => {
        record.inFlight = false;
        busy--;
        flush();
      });
    }
    if (busy < concurrentLimit && Number.isFinite(earliest)) {
      sendTimer = setTimeout(flush, Math.max(1, earliest - performance.now()));
    }
  }

  function refreshVisibility() {
    clearTimeout(readTimer);
    const scope = thread;
    if (!scope) return;
    if (!canRead()) {
      for (const record of scope.records.values()) record.visibleAt = undefined;
      flush();
      return;
    }
    const bounds = viewport.getBoundingClientRect();
    const now = performance.now();
    let earliest = Infinity;
    const visible = new Set();
    for (const row of flow.children) {
      const record = scope.records.get(row.dataset.message);
      if (!record?.received || record.target === read) continue;
      const box = row.getBoundingClientRect();
      const height = Math.min(bounds.height, box.height);
      const overlap = Math.min(box.bottom, bounds.bottom) - Math.max(box.top, bounds.top);
      if (height <= 0 || overlap < height * 0.6) continue;
      visible.add(record);
      record.visibleAt ??= now;
      const readyAt = record.visibleAt + readDelay;
      if (readyAt > now) earliest = Math.min(earliest, readyAt);
      else {
        record.target = read;
        record.failures = record.retryAt = 0;
      }
    }
    for (const record of scope.records.values()) {
      if (!visible.has(record)) record.visibleAt = undefined;
    }
    if (Number.isFinite(earliest)) readTimer = setTimeout(refreshVisibility, Math.max(1, earliest - performance.now()));
    flush();
  }

  function update(conversationId, uid, incomingIds) {
    if (thread?.id !== conversationId || thread.uid !== uid) {
      stop();
      thread = { id: conversationId, uid, records: new Map() };
    }
    const incoming = new Set(incomingIds);
    for (const [id, record] of thread.records) {
      record.received = incoming.has(id);
      if (!record.received && !record.inFlight) thread.records.delete(id);
    }
    for (const id of incoming) {
      if (thread.records.has(id)) continue;
      const key = JSON.stringify([conversationId, id]);
      const ack = acknowledged.get(key) ?? 0;
      thread.records.set(id, { id, key, ack, target: Math.max(ack, delivered), received: true, failures: 0, retryAt: 0 });
    }
    refreshVisibility();
  }

  return { update, refreshVisibility, stop, reset };
}
