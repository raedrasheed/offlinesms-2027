import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ current: { state: 'unauthenticated' } as any }));
const fake = vi.hoisted(() => ({
  current: undefined as Record<string, unknown> | undefined,
  readFailure: false,
  writes: [] as Array<{ collection: string; id?: string; data: any; options?: any }>,
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'session' }) }) }));
vi.mock('../lib/session', () => ({ verifySession: async () => session.current }));
vi.mock('../lib/firebase-admin', () => ({ adminDb: {
  collection: (collection: string) => ({
    doc: (id: string) => ({
      get: async () => {
        if (fake.readFailure) throw new Error('unavailable');
        return { exists: fake.current !== undefined, data: () => fake.current };
      },
      set: async (data: any, options: any) => { fake.writes.push({ collection, id, data, options }); },
    }),
    add: async (data: any) => { fake.writes.push({ collection, data }); },
  }),
} }));

import { updateSystemSettings } from '../lib/settingsActions';
import { getSystemSettings } from '../lib/adminData';

const fields = ['smsShowAppName', 'smsShowGroupName', 'smsShowSenderPhone'] as const;
function form(values: readonly boolean[] = [true, true, true]) {
  const data = new FormData();
  data.set('appName', 'OfflineSMS');
  data.set('defaultLanguage', 'en');
  data.set('defaultTimezone', 'UTC');
  data.set('smsEscalationEnabled', 'true');
  data.set('pointsEnabled', 'true');
  data.set('emailSignInEnabled', 'false');
  fields.forEach((field, i) => data.set(field, String(values[i])));
  return data;
}

beforeEach(() => {
  session.current = { state: 'authorized', role: 'super_admin', user: { uid: 'admin-1', claims: {} } };
  fake.current = undefined;
  fake.readFailure = false;
  fake.writes = [];
});

describe('SMS identification settings', () => {
  it('defaults all options off for new and existing settings documents', async () => {
    for (const current of [undefined, { appName: 'Custom app' }]) {
      fake.current = current;
      expect(await getSystemSettings()).toMatchObject({
        smsShowAppName: false, smsShowGroupName: false, smsShowSenderPhone: false,
      });
    }
  });

  it('reads each explicit boolean independently and does not enable malformed values', async () => {
    fake.current = { smsShowAppName: true, smsShowGroupName: false, smsShowSenderPhone: 'true' };
    expect(await getSystemSettings()).toMatchObject({
      smsShowAppName: true, smsShowGroupName: false, smsShowSenderPhone: false,
    });
  });

  it('propagates a read failure instead of providing editable default values', async () => {
    fake.readFailure = true;
    await expect(getSystemSettings()).rejects.toThrow('unavailable');
  });

  it('saves and audits each combination without replacing other settings', async () => {
    for (let mask = 0; mask < 8; mask++) {
      fake.writes = [];
      const values = fields.map((_, index) => Boolean(mask & (1 << index)));
      const expected = Object.fromEntries(fields.map((field, index) => [field, values[index]]));
      expect(await updateSystemSettings(null, form(values))).toEqual({ success: true });
      expect(fake.writes[0]).toMatchObject({
        collection: 'systemSettings', id: 'general', options: { merge: true },
        data: { ...expected, updatedBy: 'admin-1', appName: 'OfflineSMS' },
      });
      expect(fake.writes[1]).toMatchObject({
        collection: 'auditLogs', data: { action: 'system.settings.updated', metadata: expected },
      });
    }
  });

  it('rejects incomplete or malformed forms without changing active options', async () => {
    for (const field of fields) {
      const absent = form(); absent.delete(field);
      expect(await updateSystemSettings(null, absent)).toHaveProperty('error');
      const malformed = form(); malformed.set(field, 'yes');
      expect(await updateSystemSettings(null, malformed)).toHaveProperty('error');
    }
    expect(fake.writes).toHaveLength(0);
  });

  it('denies every non-platform role including bootstrap admins', async () => {
    for (const role of ['organization_admin', 'support_agent', 'finance_admin', 'auditor', 'bootstrap_admin']) {
      session.current = { state: 'authorized', role, user: { uid: 'u', claims: { organizationId: 'org-1' } } };
      expect(await updateSystemSettings(null, form())).toEqual({ error: 'Permission denied.' });
    }
    session.current = { state: 'unauthenticated' };
    expect(await updateSystemSettings(null, form())).toEqual({ error: 'Permission denied.' });
    expect(fake.writes).toHaveLength(0);
  });

  it('allows the existing legacy platform admin role', async () => {
    session.current = { state: 'authorized', role: 'legacy_admin', user: { uid: 'legacy', claims: {} } };
    expect(await updateSystemSettings(null, form())).toEqual({ success: true });
  });
});
