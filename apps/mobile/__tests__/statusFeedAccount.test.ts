import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ auth: { currentUser: { uid: 'a' } as { uid: string } | null }, invoke: vi.fn() }));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), doc: vi.fn(), onSnapshot: vi.fn(), orderBy: vi.fn(), query: vi.fn(), where: vi.fn(), limit: vi.fn(), deleteDoc: vi.fn() }));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn() }));
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(), httpsCallable: (_app: unknown, name: string) => (data: unknown) => mock.invoke(name, data) }));
vi.mock('../src/lib/firebase', () => ({ app: {}, db: {}, storage: {}, auth: mock.auth }));
const feed = () => ({ data: { items: [{ statusId: 'shared', authorId: 'owner', viewedByMe: false, likedByMe: false, likeCount: 0, expiresAtMs: Date.now() + 60_000 }] } });
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); mock.auth.currentUser = { uid: 'a' }; });
describe('status account-scoped cache', () => {
  it('does not apply account A view completion to account B feed', async () => {
    let finish!: (value: unknown) => void;
    mock.invoke.mockImplementation((name: string) => name === 'getStatusFeed' ? Promise.resolve(feed()) : new Promise(resolve => { finish = resolve; }));
    const api = await import('../src/lib/statuses'); await api.fetchStatusFeed();
    const pending = api.markStatusViewed('shared');
    mock.auth.currentUser = { uid: 'b' }; await api.fetchStatusFeed(); finish({ data: { ok: true } }); await pending;
    expect(api.peekStatusFeed()[0].viewedByMe).toBe(false);
  });
  it('does not apply account A like completion to account B feed', async () => {
    let finish!: (value: unknown) => void;
    mock.invoke.mockImplementation((name: string) => name === 'getStatusFeed' ? Promise.resolve(feed()) : new Promise(resolve => { finish = resolve; }));
    const api = await import('../src/lib/statuses'); await api.fetchStatusFeed();
    const pending = api.setStatusLike('shared', true);
    mock.auth.currentUser = { uid: 'b' }; await api.fetchStatusFeed(); finish({ data: { liked: true, likeCount: 1 } }); await pending;
    expect(api.peekStatusFeed()[0].likedByMe).toBe(false); expect(api.peekStatusFeed()[0].likeCount).toBe(0);
  });
  it('hides the old feed immediately on sign-out', async () => {
    mock.invoke.mockResolvedValue(feed());
    const api = await import('../src/lib/statuses'); await api.fetchStatusFeed();
    mock.auth.currentUser = null; expect(api.peekStatusFeed()).toEqual([]);
  });
});
