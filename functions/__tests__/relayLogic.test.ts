import { describe, it, expect } from 'vitest';
import {
  makeJobId, generatePairingCode, isPairingCodeUsable, leaseExpiryMs, isLeaseExpired,
  isHeartbeatStale, capacityRemaining, canManageBusiness, resolveBusinessId,
  normalizeReportStatus, recipientStatusFor, isTerminalJobStatus, shouldApplyReport,
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
