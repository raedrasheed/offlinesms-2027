import { describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ next: null as null | ((value: any) => void) }));
vi.mock('firebase/firestore', () => ({ collection: (...args: any[]) => args, onSnapshot: (_query: any, next: (value: any) => void) => { mock.next = next; return () => {}; } }));
vi.mock('firebase/functions', () => ({}));
vi.mock('../src/lib/firebase', () => ({ app: {}, db: {}, auth: {} }));
vi.mock('../src/lib/pollModel', () => ({ sanitizePoll: (value: any) => value }));
vi.mock('../src/lib/groupInvitationBatches', () => ({ inviteInBatches: vi.fn() }));
import { subscribeExternalMembers } from '../src/lib/conversations';
describe('canonical phone member identity', () => {
  it('uses the group document id instead of an owner-scoped private contact id', () => {
    const receive = vi.fn(); const stop = subscribeExternalMembers('g', receive);
    mock.next!({ docs: [{ id: '972591234567', data: () => ({ contactId: 'owner_972591234567', displayName: 'Phone', phoneE164: '+972591234567' }) }] });
    expect(receive).toHaveBeenCalledWith([{ contactId: '972591234567', displayName: 'Phone', phoneE164: '+972591234567' }]);
    stop();
  });
});
