// scripts/release/snapshotConfig.ts — the production configuration snapshot
// keeps the settings a rollback needs and never copies a credential.
import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { sanitize } from '../../scripts/release/snapshotConfig';

describe('release configuration snapshot', () => {
  it('redacts credential-like fields at any depth and keeps policy settings', () => {
    const v = sanitize({
      enabled: false, emergencyStop: true, businessId: 'org1', androidAppHash: 'abcDEF12345',
      signin: { enabled: false, limits: { globalPerHour: 5 } },
      http: { apiKey: 'live-key', authToken: 'tok', webhookSecret: 's', url: 'https://gw.example' },
      list: [{ password: 'p' }],
      authorizedCountries: ['PS'],
    }) as Record<string, any>;
    expect(v).toMatchObject({ enabled: false, emergencyStop: true, businessId: 'org1', androidAppHash: 'abcDEF12345' });
    expect(v.signin.limits.globalPerHour).toBe(5);
    expect(v.http).toEqual({ apiKey: '<redacted>', authToken: '<redacted>', webhookSecret: '<redacted>', url: 'https://gw.example' });
    expect(v.list[0].password).toBe('<redacted>');
    expect(v.authorizedCountries).toEqual(['PS']);
    expect(JSON.stringify(v)).not.toMatch(/live-key|"tok"|"s"|"p"/);
  });

  it('writes timestamps as ISO strings', () => {
    expect(sanitize({ at: Timestamp.fromMillis(0) })).toEqual({ at: '1970-01-01T00:00:00.000Z' });
  });
});
