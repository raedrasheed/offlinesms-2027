// Minimal in-memory stand-in for the parts of the Firestore web SDK the local
// feeders use (collection/doc/query/onSnapshot/getDoc/getDocs + docChanges()).
// The perf harness and sync tests drive snapshots through it, so the app's REAL
// feeder code runs against real SQLite. Snapshots mirror Firestore semantics:
// `docs` = the whole query window every time; `docChanges()` = only what changed.

type Data = Record<string, any>;
interface Ref { kind: 'doc' | 'query'; path: string; limit?: number; order?: 'asc' | 'desc' }
type Listener = { target: Ref; next: (snap: any) => void; prev: Map<string, string> };

const store = new Map<string, Data>();       // doc path -> data
const listeners: Listener[] = [];

const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) });

export function resetFake() { store.clear(); listeners.length = 0; }
export const fakeTs = ts;

function children(collPath: string): Array<[string, Data]> {
  const out: Array<[string, Data]> = [];
  for (const [p, d] of store) {
    const i = p.lastIndexOf('/');
    if (p.slice(0, i) === collPath) out.push([p.slice(i + 1), d]);
  }
  return out;
}

function evalQuery(q: Ref): Array<[string, Data]> {
  let rows = children(q.path);
  rows.sort((a, b) => (a[1].createdAt?.toMillis?.() ?? a[1].updatedAt?.toMillis?.() ?? 0) - (b[1].createdAt?.toMillis?.() ?? b[1].updatedAt?.toMillis?.() ?? 0));
  if (q.order === 'desc') rows.reverse();
  if (q.limit) rows = rows.slice(0, q.limit);
  return rows;
}

function snapshotFor(l: Listener, fromCache = false) {
  if (l.target.kind === 'doc') {
    const d = store.get(l.target.path);
    return { exists: () => !!d, data: () => d, id: l.target.path.split('/').pop(), metadata: { fromCache } };
  }
  const rows = evalQuery(l.target);
  const next = new Map(rows.map(([id, d]) => [id, JSON.stringify(d)]));
  const docs = rows.map(([id, d]) => ({ id, data: () => d }));
  const changes: any[] = [];
  for (const [id, d] of rows) {
    const before = l.prev.get(id);
    if (before === undefined) changes.push({ type: 'added', doc: { id, data: () => d } });
    else if (before !== JSON.stringify(d)) changes.push({ type: 'modified', doc: { id, data: () => d } });
  }
  for (const id of l.prev.keys()) if (!next.has(id)) changes.push({ type: 'removed', doc: { id, data: () => ({}) } });
  l.prev = next;
  return { docs, size: docs.length, forEach: (f: any) => docs.forEach(f), docChanges: () => changes, metadata: { fromCache } };
}

/** Write a document and fire every affected listener (like a server update). */
export function fakeWrite(path: string, data: Data) {
  store.set(path, data);
  const coll = path.slice(0, path.lastIndexOf('/'));
  for (const l of listeners) {
    if ((l.target.kind === 'doc' && l.target.path === path) || (l.target.kind === 'query' && l.target.path === coll)) {
      l.next(snapshotFor(l));
    }
  }
}
/** Seed without firing listeners. */
export function fakeSeed(path: string, data: Data) { store.set(path, data); }

export const firestoreMock = {
  collection: (_db: unknown, ...segs: string[]): Ref => ({ kind: 'query', path: segs.join('/') }),
  doc: (_db: unknown, ...segs: string[]): Ref => ({ kind: 'doc', path: segs.join('/') }),
  query: (base: Ref, ...cs: any[]): Ref => {
    const q = { ...base };
    for (const c of cs) { if (c?.limit) q.limit = c.limit; if (c?.order) q.order = c.order; }
    return q;
  },
  where: () => ({}),
  orderBy: (_f: string, dir?: 'asc' | 'desc') => ({ order: dir ?? 'asc' }),
  limit: (n: number) => ({ limit: n }),
  Timestamp: { fromMillis: ts },
  onSnapshot: (target: Ref, next: (s: any) => void) => {
    const l: Listener = { target, next, prev: new Map() };
    listeners.push(l);
    queueMicrotask(() => next(snapshotFor(l)));
    return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
  },
  getDoc: async (r: Ref) => { const d = store.get(r.path); return { exists: () => !!d, data: () => d, id: r.path.split('/').pop() }; },
  getDocs: async (q: Ref) => { const rows = evalQuery(q); return { docs: rows.map(([id, d]) => ({ id, data: () => d })), size: rows.length }; },
};
