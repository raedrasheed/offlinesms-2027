import { describe, it, expect } from 'vitest';
import {
  makeJobId, generatePairingCode, isPairingCodeUsable, leaseExpiryMs, isLeaseExpired,
  isHeartbeatStale, capacityRemaining, canManageBusiness, resolveBusinessId,
  normalizeReportStatus, recipientStatusFor, isTerminalJobStatus, shouldApplyReport,
  classifyFailure, backoffMs, failureOutcome, reapDecision, isClaimable, utcDayKey,
  BACKOFF_BASE_MS, BACKOFF_MAX_MS,
  PAIRING_CODE_TTL_MS, LEASE_TTL_MS,
} from '../src/sms/relayLogic';

describe('makeJobId', () => {
  it('is stable and recipient-scoped', () => {
    expect(makeJobId('batch1', 'uidA')).toBe('batch1:uidA');
    expect(makeJobId('batch1', 'uidA')).toBe(makeJobId('batch1', 'uidA'));
  });
});

describe('generatePairingCode', () => {
  it('is 8 chars from the unambiguous alphabet', () => {
    const code = generatePairingCode(() => 0.5);
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  });
});

describe('isPairingCodeUsable', () => {
  const now = 1_000_000;
  it('false when null/used/expired, true when fresh & unused', () => {
    expect(isPairingCodeUsable(null, now)).toBe(false);
    expect(isPairingCodeUsable({ used: true, expiresAtMs: now + 1000 }, now)).toBe(false);
    expect(isPairingCodeUsable({ used: false, expiresAtMs: now - 1 }, now)).toBe(false);
    expect(isPairingCodeUsable({ used: false, expiresAtMs: now + PAIRING_CODE_TTL_MS }, now)).toBe(true);
  });
});

describe('lease + heartbeat', () => {
  it('expiry math and staleness', () => {
    const now = 5_000;
    expect(leaseExpiryMs(now)).toBe(now + LEASE_TTL_MS);
    expect(isLeaseExpired(now - 1, now)).toBe(true);
    expect(isLeaseExpired(now + 1, now)).toBe(false);
    expect(isLeaseExpired(null, now)).toBe(true);
    expect(isHeartbeatStale(null, now)).toBe(true);
    expect(isHeartbeatStale(now, now)).toBe(false);
    expect(isHeartbeatStale(now - 200_000, now)).toBe(true);
  });
});

describe('capacityRemaining', () => {
  it('clamps to the daily cap and the request', () => {
    expect(capacityRemaining({ maxPerDay: 500 }, { sentToday: 0 }, 10)).toBe(10);
    expect(capacityRemaining({ maxPerDay: 5 }, { sentToday: 3 }, 10)).toBe(2);
    expect(capacityRemaining({ maxPerDay: 5 }, { sentToday: 5 }, 10)).toBe(0);
    expect(capacityRemaining({ maxPerDay: 5 }, { sentToday: 99 }, 10)).toBe(0);
  });
});

describe('business authorization', () => {
  it('super_admin manages any business; org_admin only its own', () => {
    expect(canManageBusiness({ role: 'super_admin' }, 'biz1')).toBe(true);
    expect(canManageBusiness({ role: 'organization_admin', organizationId: 'biz1' }, 'biz1')).toBe(true);
    expect(canManageBusiness({ role: 'organization_admin', organizationId: 'biz1' }, 'biz2')).toBe(false);
    expect(canManageBusiness({ role: 'support_agent', organizationId: 'biz1' }, 'biz1')).toBe(false);
    expect(canManageBusiness(undefined, 'biz1')).toBe(false);
  });

  it('resolveBusinessId derives the acting business', () => {
    expect(resolveBusinessId({ role: 'organization_admin', organizationId: 'biz1' })).toBe('biz1');
    expect(resolveBusinessId({ role: 'super_admin', organizationId: 'hq' })).toBe('hq');
    expect(resolveBusinessId({ role: 'super_admin' }, 'biz9')).toBe('biz9');
    expect(resolveBusinessId({ role: 'support_agent', organizationId: 'biz1' })).toBeNull();
    expect(resolveBusinessId(undefined)).toBeNull();
  });
});

describe('report status mapping + idempotency', () => {
  it('validates and maps to recipient vocabulary', () => {
    expect(normalizeReportStatus('sent')).toBe('sent');
    expect(normalizeReportStatus('delivered')).toBe('delivered');
    expect(normalizeReportStatus('queued')).toBeNull();
    expect(recipientStatusFor('delivered')).toBe('delivered');
  });

  it('blocks transitions out of terminal states / duplicate sent', () => {
    expect(isTerminalJobStatus('delivered')).toBe(true);
    expect(isTerminalJobStatus('failed')).toBe(true);
    expect(isTerminalJobStatus('sent')).toBe(false);
    expect(shouldApplyReport('delivered', 'failed')).toBe(false);
    expect(shouldApplyReport('failed', 'delivered')).toBe(false);
    expect(shouldApplyReport('sent', 'sent')).toBe(false);
    expect(shouldApplyReport('sent', 'delivered')).toBe(true);
    expect(shouldApplyReport('claimed', 'sent')).toBe(true);
  });
});

describe('failure classification (Phase 3)', () => {
  it('flags permanent vs transient by reason and Android code', () => {
    expect(classifyFailure(null, 'invalid destination')).toBe('permanent');
    expect(classifyFailure(null, 'permission denied')).toBe('permanent');
    expect(classifyFailure(2, null)).toBe('permanent');   // NULL_PDU
    expect(classifyFailure(6, null)).toBe('permanent');   // FDN
    expect(classifyFailure(4, null)).toBe('transient');   // NO_SERVICE
    expect(classifyFailure(3, null)).toBe('transient');   // RADIO_OFF
    expect(classifyFailure(null, 'network unavailable')).toBe('transient');
    expect(classifyFailure(null, null)).toBe('transient'); // unknown → retry
  });
});

describe('backoff + failure outcome', () => {
  it('exponential backoff is capped', () => {
    expect(backoffMs(1)).toBe(BACKOFF_BASE_MS);
    expect(backoffMs(2)).toBe(BACKOFF_BASE_MS * 2);
    expect(backoffMs(3)).toBe(BACKOFF_BASE_MS * 4);
    expect(backoffMs(99)).toBe(BACKOFF_MAX_MS);
  });
  it('permanent never requeues; transient requeues until attempts exhausted', () => {
    expect(failureOutcome(1, 3, 'permanent')).toBe('fail');
    expect(failureOutcome(1, 3, 'transient')).toBe('requeue');
    expect(failureOutcome(2, 3, 'transient')).toBe('requeue');
    expect(failureOutcome(3, 3, 'transient')).toBe('fail');
    expect(failureOutcome(5, 3, 'transient')).toBe('fail');
  });
});

describe('reaper decision + claimability', () => {
  const now = 1_000_000;
  it('only acts on in-flight jobs with a lapsed lease', () => {
    expect(reapDecision({ status: 'queued', leaseExpiresAtMs: now - 1, attempts: 1, maxAttempts: 3 }, now)).toBe('none');
    expect(reapDecision({ status: 'delivered', leaseExpiresAtMs: now - 1, attempts: 1, maxAttempts: 3 }, now)).toBe('none');
    expect(reapDecision({ status: 'claimed', leaseExpiresAtMs: now + 1, attempts: 1, maxAttempts: 3 }, now)).toBe('none');
    expect(reapDecision({ status: 'claimed', leaseExpiresAtMs: null, attempts: 1, maxAttempts: 3 }, now)).toBe('none');
    expect(reapDecision({ status: 'claimed', leaseExpiresAtMs: now - 1, attempts: 1, maxAttempts: 3 }, now)).toBe('requeue');
    expect(reapDecision({ status: 'sending', leaseExpiresAtMs: now - 1, attempts: 3, maxAttempts: 3 }, now)).toBe('fail');
  });
  it('isClaimable honours the backoff window', () => {
    expect(isClaimable(null, now)).toBe(true);
    expect(isClaimable(now - 1, now)).toBe(true);
    expect(isClaimable(now + 1, now)).toBe(false);
  });
  it('utcDayKey is a UTC yyyymmdd string', () => {
    expect(utcDayKey(new Date('2026-05-28T23:30:00Z'))).toBe('20260528');
  });
});
