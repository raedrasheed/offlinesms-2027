import { beforeEach, describe, expect, it, vi } from 'vitest';
const session = vi.hoisted(() => ({ current: { state: 'unauthenticated' } as any }));
const fake = vi.hoisted(() => ({ current: { messageRetentionDays: 14, messageRetentionEnabled: false }, writes: [] as any[] }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => ({ value: 'session' }) }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/session', () => ({ verifySession: async () => session.current }));
vi.mock('../lib/firebase-admin', () => ({ adminDb: {
  doc: (path: string) => ({ path }), collection: () => ({ doc: () => ({ path: 'audit' }) }),
  runTransaction: async (fn: any) => fn({
    get: async () => ({ data: () => fake.current }),
    set: (ref: any, data: any) => fake.writes.push({ ref, data }),
    create: (ref: any, data: any) => fake.writes.push({ ref, data }),
  }),
} }));
import { updateMessageRetention, previewMessageRetention } from '../lib/messageRetentionActions';
function form(days = '14', enabled = true, confirm = '') {
  const f = new FormData(); f.set('messageRetentionDays', days);
  if (enabled) f.set('messageRetentionEnabled', 'true');
  f.set('confirmedDays', confirm); return f;
}
beforeEach(() => { fake.writes = []; fake.current = { messageRetentionDays: 14, messageRetentionEnabled: false }; });
describe('retention dashboard authorization and validation', () => {
  it('rejects organization/support/bootstrap admins for both preview and writes', async () => {
    for (const role of ['organization_admin', 'support_agent', 'bootstrap_admin', 'auditor']) {
      session.current = { state: 'authorized', role, user: { uid: 'a', claims: {} } };
      expect(await updateMessageRetention(null, form())).toHaveProperty('error');
      expect(await previewMessageRetention(14)).toHaveProperty('error');
    }
    expect(fake.writes).toHaveLength(0);
  });
  it('validates days, requires confirmation for destructive changes, and atomically audits a valid save', async () => {
    session.current = { state: 'authorized', role: 'super_admin', user: { uid: 'a', claims: {} } };
    for (const days of ['0', '1.2', '3651', 'no']) expect(await updateMessageRetention(null, form(days))).toHaveProperty('error');
    expect(await updateMessageRetention(null, form())).toHaveProperty('error');
    expect(fake.writes).toHaveLength(0);
    expect(await updateMessageRetention(null, form('14', true, '14'))).toEqual({ success: true });
    expect(fake.writes[0].data).toMatchObject({ messageRetentionDays: 14, messageRetentionEnabled: true });
    expect(fake.writes[1].data.action).toBe('message.retention.updated');
  });
});
