import { describe, expect, it, vi } from 'vitest';
import { inviteInBatches } from '../src/lib/groupInvitationBatches';

describe('large group invitations', () => {
  it('sends every selected recipient once in bounded sequential requests', async () => {
    const users = Array.from({ length: 1001 }, (_, i) => `u${i}`);
    let active = 0;
    const send = vi.fn(async (batch: string[]) => {
      expect(++active).toBe(1);
      await Promise.resolve(); active--;
      return batch.length;
    });
    expect(await inviteInBatches([...users, users[0]], send)).toBe(1001);
    expect(send.mock.calls.map(([batch]) => batch.length)).toEqual([240, 240, 240, 240, 41]);
    expect(send.mock.calls.flatMap(([batch]) => batch)).toEqual(users);
  });

  it('stops on failure and can retry without losing the remaining selection', async () => {
    const users = Array.from({ length: 501 }, (_, i) => `u${i}`);
    const invitations = new Set<string>();
    let calls = 0;
    const send = async (batch: string[]) => {
      if (++calls === 2) throw new Error('offline');
      const fresh = batch.filter(u => !invitations.has(u));
      fresh.forEach(u => invitations.add(u));
      return fresh.length;
    };
    await expect(inviteInBatches(users, send)).rejects.toThrow('offline');
    expect(invitations.size).toBe(240);
    expect(await inviteInBatches(users, send)).toBe(261);
    expect([...invitations]).toEqual(users);
  });
});
