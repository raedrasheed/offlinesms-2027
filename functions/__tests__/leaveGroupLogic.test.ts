import { describe, it, expect } from 'vitest';
import { chooseOwnershipSuccessor } from '../src/chats/leaveGroupLogic';

describe('chooseOwnershipSuccessor', () => {
  it('returns null when there are no candidates', () => {
    expect(chooseOwnershipSuccessor([])).toBeNull();
  });

  it('prefers an admin over a more senior member', () => {
    const successor = chooseOwnershipSuccessor([
      { uid: 'member-old', role: 'member', joinedAtMs: 100 },
      { uid: 'admin-new',  role: 'admin',  joinedAtMs: 900 },
    ]);
    expect(successor).toBe('admin-new');
  });

  it('picks the most senior admin among admins', () => {
    const successor = chooseOwnershipSuccessor([
      { uid: 'admin-new', role: 'admin', joinedAtMs: 500 },
      { uid: 'admin-old', role: 'admin', joinedAtMs: 200 },
    ]);
    expect(successor).toBe('admin-old');
  });

  it('falls back to the most senior member when there are no admins', () => {
    const successor = chooseOwnershipSuccessor([
      { uid: 'm-new', role: 'member', joinedAtMs: 800 },
      { uid: 'm-old', role: 'member', joinedAtMs: 300 },
    ]);
    expect(successor).toBe('m-old');
  });

  it('breaks ties on joinedAt deterministically by uid', () => {
    const successor = chooseOwnershipSuccessor([
      { uid: 'bbb', role: 'member', joinedAtMs: 0 },
      { uid: 'aaa', role: 'member', joinedAtMs: 0 },
    ]);
    expect(successor).toBe('aaa');
  });
});
