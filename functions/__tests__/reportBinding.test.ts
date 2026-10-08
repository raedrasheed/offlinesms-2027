// Third review (M2) — pure rules that bind a relay report to one attempt.

import { describe, it, expect } from 'vitest';
import {
  reportBinding, isPossiblySentReport, shouldApplyReport, failureOutcome, reapDecision,
} from '../src/sms/relayLogic';

const job = (jobAttempts: number, attemptDeviceId: string | null = 'd1') => ({ jobAttempts, attemptDeviceId, deviceId: 'd1' });
const owners = (o: Record<string, string>) => ({ attemptOwners: o });

describe('reportBinding — server-issued attempt ownership (M2 / Q1)', () => {
  it('current only for the current attempt from its proven holder', () => {
    expect(reportBinding({ ...job(2), ...owners({ 1: 'd1', 2: 'd1' }), reportAttempt: 2 })).toBe('current');
    expect(reportBinding({ ...job(2, 'd2'), ...owners({ 1: 'd1', 2: 'd2' }), reportAttempt: 2 })).toBe('foreign');
  });
  it('an earlier attempt counts as stale ONLY when the reporter is on record as its holder', () => {
    expect(reportBinding({ ...job(2, 'd2'), ...owners({ 1: 'd1', 2: 'd2' }), reportAttempt: 1 })).toBe('stale');
    expect(reportBinding({ jobAttempts: 2, attemptDeviceId: 'd1', deviceId: 'd3', ...owners({ 1: 'd1', 2: 'd1' }), reportAttempt: 1 })).toBe('foreign');
  });
  it('future / never-issued attempts are unverified (never write authority)', () => {
    expect(reportBinding({ ...job(0, null), reportAttempt: 99 })).toBe('unverified');            // never leased
    expect(reportBinding({ ...job(2), ...owners({ 1: 'd1', 2: 'd1' }), reportAttempt: 3 })).toBe('unverified');
    expect(reportBinding({ ...job(2, 'd2'), ...owners({ 1: 'd2', 2: 'd2' }), reportAttempt: 99 })).toBe('unverified');
  });
  it('legacy jobs (no attemptOwners): only the current attempt holder is known; history is unverified', () => {
    expect(reportBinding({ ...job(2), reportAttempt: 2 })).toBe('current');
    expect(reportBinding({ ...job(2), reportAttempt: 1 })).toBe('unverified');
    expect(reportBinding({ jobAttempts: 1, attemptDeviceId: null, leaseOwnerDeviceId: 'd1', deviceId: 'd1', reportAttempt: 1 })).toBe('current');
    expect(reportBinding({ jobAttempts: 1, attemptDeviceId: null, leaseOwnerDeviceId: null, deviceId: 'd1', reportAttempt: 1 })).toBe('unverified');
  });
  it('reports without attempt identity bind only to a never-re-leased job held by the reporter', () => {
    expect(reportBinding({ ...job(1), ...owners({ 1: 'd1' }), reportAttempt: undefined })).toBe('current');
    expect(reportBinding({ ...job(1, 'd2'), ...owners({ 1: 'd2' }), reportAttempt: undefined })).toBe('foreign');
    expect(reportBinding({ ...job(2), ...owners({ 1: 'd1', 2: 'd1' }), reportAttempt: undefined })).toBe('unbound');
    expect(reportBinding({ ...job(0, null), reportAttempt: null })).toBe('unbound');
  });
  it('garbage attempt values are treated as missing', () => {
    for (const a of [0, -1, 1.5, '2', NaN]) expect(reportBinding({ ...job(2), reportAttempt: a })).toBe('unbound');
  });
});

describe('possibly-sent reports and retry stops', () => {
  it('sent/delivered and ambiguous failures may have gone out; ordinary failures not', () => {
    expect(isPossiblySentReport('sent')).toBe(true);
    expect(isPossiblySentReport('delivered')).toBe(true);
    expect(isPossiblySentReport('failed', 'ambiguous-handoff')).toBe(true);
    expect(isPossiblySentReport('failed', 'ambiguous-partial-send')).toBe(true);
    expect(isPossiblySentReport('failed', 'no-service')).toBe(false);
  });
  it('a sent job is never turned back by a later failure', () => {
    expect(shouldApplyReport('sent', 'failed')).toBe(false);
    expect(shouldApplyReport('sent', 'delivered')).toBe(true);
  });
  it('noRetry turns every would-be requeue into a terminal failure', () => {
    expect(failureOutcome(1, 3, 'transient', undefined, true)).toBe('fail');
    expect(failureOutcome(1, 3, 'transient', undefined, false)).toBe('requeue');
    const lapsed = { status: 'claimed' as const, leaseExpiresAtMs: 1, attempts: 1, maxAttempts: 3 };
    expect(reapDecision({ ...lapsed, noRetry: true }, 5)).toBe('fail');
    expect(reapDecision(lapsed, 5)).toBe('requeue');
  });
});
