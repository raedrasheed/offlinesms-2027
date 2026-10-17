import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ snapshot: null as any, calls: vi.fn() }));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), orderBy: vi.fn(), query: vi.fn(), limit: vi.fn(),
  onSnapshot: (_query: unknown, cb: any) => { state.snapshot = cb; return () => {}; },
}));
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}),
  httpsCallable: (_: unknown, name: string) => async (data: unknown) => ({ data: await state.calls(name, data) }),
}));
vi.mock('../src/lib/firebase', () => ({ app: {}, db: {}, auth: { currentUser: { uid: 'alice' } } }));
import { subscribeMessages, sendRichMessage, votePoll } from '../src/lib/conversations';
beforeEach(() => { state.calls.mockReset().mockResolvedValue({ messageId: 'poll' }); });
describe('polls without the local-first database', () => {
  it('decodes the legacy guard into an open anonymous UI poll, using server totals', () => {
    const cb = vi.fn(); subscribeMessages('chat', cb);
    state.snapshot({ docs: [{ id: 'poll', data: () => ({ type: 'poll', poll: {
      anonymous: true, closed: true, votingClosed: false, question: 'Q',
      options: [{ id: 'o1', text: 'Yes' }, { id: 'o2', text: 'No' }],
      votes: {}, counts: { o1: 2, o2: 1 }, voterCount: 3,
    } }) }] });
    expect(cb.mock.calls[0][0][0]).toMatchObject({ poll: { anonymous: true, closed: false, voterCount: 3, counts: { o1: 2, o2: 1 } } });
  });
  it('binds a direct vote to the account that selected it', async () => {
    await votePoll('chat', 'poll', ['o1'], 10, 'original-account');
    expect(state.calls).toHaveBeenCalledWith('votePoll', expect.objectContaining({ voterUid: 'original-account', optionIds: ['o1'] }));
  });
  it.each([true, false])('routes anonymous=%s creation to the right capability without fallback', async anonymous => {
    await sendRichMessage('chat', { kind: 'poll', poll: { question: 'Q', options: ['Yes', 'No'], multiple: false, anonymous } });
    expect(state.calls).toHaveBeenCalledWith(anonymous ? 'sendPollMessage' : 'sendTextMessage', expect.objectContaining({ kind: 'poll' }));
    state.calls.mockClear().mockRejectedValue(new Error('not-found'));
    await expect(sendRichMessage('chat', { kind: 'poll', poll: { question: 'Q', options: ['Yes', 'No'], multiple: false, anonymous } })).rejects.toThrow('not-found');
    expect(state.calls).toHaveBeenCalledOnce();
  });
});
