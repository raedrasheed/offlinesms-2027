// Minimal in-memory stand-in for the parts of the Firestore web SDK the local
// feeders use (collection/doc/query/onSnapshot/getDoc/getDocs + docChanges()).
// The perf harness and sync tests drive snapshots through it, so the app's REAL
// feeder code runs against real SQLite. Snapshots mirror Firestore semantics:
// `docs` = the whole query window every time; `docChanges()` = only what changed.

type Data = Record<string, any>;
interface Ref { kind: 'doc' | 'query'; path: string; limit?: number; order?: 'asc' | 'desc'; fields?: string[]; filters?: any[]; cursor?: any[] }
type Listener = { target: Ref; next: (snap: any) => void; prev: Map<string, string> };

const store = new Map<string, Data>();       // doc path -> data
const listeners: Listener[] = [];

class FakeTimestamp {
  constructor(public seconds: number, public nanoseconds: number) {}
  toMillis() { return this.seconds * 1000 + this.nanoseconds / 1e6; }
  toDate() { return new Date(this.toMillis()); }
  static fromMillis(ms: number) { return new FakeTimestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); }
}
const ts = FakeTimestamp.fromMillis;

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
  const value = (x: any): any => x?.toMillis?.() ?? x;
  for (const f of q.filters ?? []) rows = rows.filter(([, d]) => {
    const a = value(d[f.field]), b = value(f.value);
    switch (f.op) {
      case '>': return a > b;
      case '>=': return a >= b;
      case '<': return a < b;
      case '<=': return a <= b;
      case '==': return a === b;
      case 'array-contains': return a?.includes(b);
      default: throw new Error(`Unimplemented fake query operator: ${f.op}`);
    }
  });
  const values = (r: [string, Data]) => (q.fields ?? ['createdAt', '__name__']).map(f => f === '__name__' ? r[0] : value(r[1][f]));
  const compare = (a: any[], b: any[]) => {
    for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; }
    return 0;
  };
  const sign = q.order === 'desc' ? -1 : 1;
  rows.sort((a, b) => sign * compare(values(a), values(b)));
  if (q.cursor) rows = rows.filter(r => sign * compare(values(r), q.cursor!.map(value)) > 0);
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

const baseMock = {
  collection: (_db: unknown, ...segs: string[]): Ref => ({ kind: 'query', path: segs.join('/') }),
  doc: (_db: unknown, ...segs: string[]): Ref => ({ kind: 'doc', path: segs.join('/') }),
  query: (base: Ref, ...cs: any[]): Ref => {
    const q = { ...base };
    q.fields = []; q.filters = [];
    for (const c of cs) {
      if (c?.limit) q.limit = c.limit;
      if (c?.order) { q.order = c.order; q.fields.push(c.field); }
      if (c?.filter) q.filters.push(c.filter);
      if (c?.cursor) q.cursor = c.cursor;
    }
    return q;
  },
  where: (field: string, op: string, value: any) => ({ filter: { field, op, value } }),
  documentId: () => '__name__',
  startAfter: (...cursor: any[]) => ({ cursor }),
  orderBy: (field: string, dir?: 'asc' | 'desc') => ({ field, order: dir ?? 'asc' }),
  limit: (n: number) => ({ limit: n }),
  Timestamp: FakeTimestamp,
  onSnapshot: (target: Ref, optionsOrNext: { includeMetadataChanges: boolean } | ((s: any) => void), callback?: (s: any) => void) => {
    const next = typeof optionsOrNext === 'function' ? optionsOrNext : callback!;
    const l: Listener = { target, next, prev: new Map() };
    listeners.push(l);
    queueMicrotask(() => next(snapshotFor(l)));
    return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
  },
  getDocFromServer: async (r: Ref) => { const d = store.get(r.path); return { exists: () => !!d, data: () => d, id: r.path.split('/').pop() }; },
  getDocsFromServer: async (q: Ref) => { const rows = evalQuery(q); return { docs: rows.map(([id, d]) => ({ id, data: () => d })), size: rows.length }; },
};

export const firestoreMock = { ...baseMock, getDoc: baseMock.getDocFromServer, getDocs: baseMock.getDocsFromServer };
