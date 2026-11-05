import { describe, expect, it } from 'vitest';
import {
  canonicalGroupParticipants, parseReconciliationArgs, planGroupMediaAccess,
} from '../../scripts/reconcileGroupMediaAccess';

describe('group media access reconciliation plan', () => {
  it('only removes candidates from participantUids, never restores stale memberIds', () => {
    const plan = planGroupMediaAccess({
      participantUids: ['owner', 'active', 'removed', 'missing', 'legacy', 'null-status', 'pending', 'left'],
      memberIds: ['owner', 'active', 'removed', 'missing', 'stale-active'],
    }, new Map([
      ['owner', { exists: true, status: 'active' }],
      ['active', { exists: true, status: 'active' }],
      ['removed', { exists: true, status: 'removed' }],
      ['missing', { exists: false }],
      ['legacy', { exists: true }],
      ['null-status', { exists: true, status: null }],
      ['pending', { exists: true, status: 'pending' }],
      ['left', { exists: true, status: 'left' }],
      ['stale-active', { exists: true, status: 'active' }],
    ]));
    expect(plan).toEqual({
      source: 'participantUids', participantUids: ['owner', 'active', 'legacy'],
      beforeCount: 8, afterCount: 3, removedCount: 5,
    });
  });

  it('uses memberIds only when participantUids is absent, and deduplicates without adding users', () => {
    expect(canonicalGroupParticipants({ memberIds: ['one', 'one', 'two'] }))
      .toEqual({ source: 'memberIds', participantUids: ['one', 'two'] });
    expect(planGroupMediaAccess({ participantUids: [], memberIds: ['stale'] }, new Map()))
      .toMatchObject({ participantUids: [], beforeCount: 0, afterCount: 0 });
  });

  it.each([
    { participantUids: null, memberIds: ['stale'] },
    { participantUids: undefined, memberIds: ['stale'] },
    { participantUids: 'owner', memberIds: ['stale'] },
    { participantUids: ['owner', null] },
    { participantUids: ['owner', 'bad/path'] },
    { participantUids: [''] },
    {},
  ])('does not certify malformed canonical membership: %j', data => {
    expect(() => canonicalGroupParticipants(data)).toThrow('Invalid canonical membership');
  });

  it('refuses to certify a candidate whose member document was never checked', () => {
    expect(() => planGroupMediaAccess(
      { participantUids: ['unchecked'] }, new Map(),
    )).toThrow('Not all candidate member documents were checked');
  });
});

describe('group media reconciliation command arguments', () => {
  it('defaults to read-only and requires an explicit project', () => {
    expect(parseReconciliationArgs(['--project=demo-offlinesms']))
      .toEqual({ projectId: 'demo-offlinesms', apply: false });
    expect(() => parseReconciliationArgs([])).toThrow('explicit --project');
    expect(() => parseReconciliationArgs(['--apply'])).toThrow('explicit --project');
  });

  it('only writes with the exact --apply flag and can target one group', () => {
    expect(parseReconciliationArgs(['--project=demo-offlinesms', '--group=g', '--apply']))
      .toEqual({ projectId: 'demo-offlinesms', groupId: 'g', apply: true });
    expect(() => parseReconciliationArgs(['--project=demo-offlinesms', '--apply=true'])).toThrow();
    expect(() => parseReconciliationArgs(['--project=demo-offlinesms', '--group=bad/path'])).toThrow();
    expect(() => parseReconciliationArgs(['--project=one', '--project=two'])).toThrow();
  });
});
