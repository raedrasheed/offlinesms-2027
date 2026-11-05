import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ request: vi.fn(), confirm: vi.fn(), changed: vi.fn(), uid: 'owner', database: {} }));
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}), httpsCallable: () => mock.request }));
vi.mock('expo-file-system', () => ({}));
vi.mock('../src/lib/firebase', () => ({ app: {}, auth: {} }));
vi.mock('../src/localdb/connection', () => ({ getCurrentUid: () => mock.uid, getDb: () => mock.database }));
vi.mock('../src/localdb/repositories/messagesRepo', () => ({}));
vi.mock('../src/localdb/repositories/externalMembersRepo', () => ({ confirmExternalMember: mock.confirm }));
vi.mock('../src/localdb/externalMemberChanges', () => ({ emitExternalMembersChanged: mock.changed }));
vi.mock('../src/localdb/pollVote', () => ({ saveOwnPollVote: vi.fn() }));
import { pushOutboxItem } from '../src/localdb/sync/firebasePush';
import type { OutboxRow } from '../src/localdb/types';
const payload = { conversationId: 'g', displayName: 'Phone', phoneNumber: '+972591234567' };
const item = { id: 'request', type: 'add_external_contact_to_group', entity_id: '972591234567', payload_json: JSON.stringify(payload) } as OutboxRow;
beforeEach(() => { vi.clearAllMocks(); mock.uid = 'owner'; mock.request.mockResolvedValue({ data: { added: 1 } }); mock.confirm.mockResolvedValue(undefined); });
describe('external membership server acknowledgement', () => {
  it('confirms only after the privileged callable succeeds', async () => {
    await expect(pushOutboxItem(item)).resolves.toEqual({ ok: true });
    expect(mock.request).toHaveBeenCalledWith(payload);
    expect(mock.confirm).toHaveBeenCalledWith('g', item.entity_id, item.id, mock.database);
    expect(mock.changed).toHaveBeenCalledWith('g', 'owner');
  });
  it('preserves the pending contact when the server rejects or cannot complete the request', async () => {
    mock.request.mockRejectedValueOnce(new Error('unavailable'));
    await expect(pushOutboxItem(item)).rejects.toThrow('unavailable');
    expect(mock.confirm).not.toHaveBeenCalled();
  });
  it('does not acknowledge or notify the replacement account after a delayed response', async () => {
    let finish!: (value: any) => void;
    mock.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = pushOutboxItem(item); mock.uid = 'another'; finish({ data: { added: 1 } }); await pending;
    expect(mock.confirm).not.toHaveBeenCalled(); expect(mock.changed).not.toHaveBeenCalled();
  });
});
