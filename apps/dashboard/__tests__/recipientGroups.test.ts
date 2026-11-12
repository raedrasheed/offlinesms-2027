import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRecipientWorkbook, RECIPIENT_GROUP_MAX } from '../lib/recipientGroupValidation';
import { saveRecipientGroupImport, getRecipientGroup } from '../lib/orgRecipientGroups';

const memory = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  writes: [] as string[],
  id: 0,
}));

vi.mock('../lib/firebase-admin', () => {
  function doc(path: string) {
    const snapshot = () => ({ id: path.split('/').at(-1), exists: memory.docs.has(path), get: (key: string) => memory.docs.get(path)?.[key] });
    return { path, id: path.split('/').at(-1), snapshot, get: async () => snapshot(),
      collection: (name: string) => collection(path + '/' + name) };
  }
  function collection(path: string) {
    return { doc: (id = String(++memory.id)) => doc(path + '/' + id) };
  }
  function write(ref: ReturnType<typeof doc>, data: Record<string, unknown>) {
    memory.writes.push(ref.path);
    memory.docs.set(ref.path, { ...memory.docs.get(ref.path), ...data });
  }
  return { adminDb: { collection, runTransaction: async (callback: (tx: unknown) => unknown) =>
    callback({ getAll: async (...refs: ReturnType<typeof doc>[]) => refs.map(ref => ref.snapshot()), create: write, update: write }) } };
});

const first = { name: 'First recipient', phone: '+12025550123' };
const second = { name: 'Second recipient', phone: '+12025550124' };

beforeEach(() => {
  memory.docs.clear();
  memory.writes.length = 0;
  memory.docs.set('organizations/school', { status: 'active' });
  memory.docs.set('organizations/other', { status: 'active' });
});

describe('Excel recipient import', () => {
  it('reads Arabic columns and digits, ignores empty rows and reports duplicate and invalid row numbers', () => {
    expect(parseRecipientWorkbook([
      ['رقم الهاتف', 'الإسم'],
      ['+١ ٢٠٢-٥٥٥-٠١٢٣', 'First recipient'],
      [null, null],
      ['+12025550123', 'Duplicate'],
      [12025550124, 'Excel numeric cell'],
    ])).toEqual({
      recipients: [first],
      duplicateRows: [4],
      invalidRows: [{ row: 5, error: expect.any(String) }],
    });
  });

  it('rejects ambiguous columns and excessive imports', () => {
    expect(parseRecipientWorkbook([['name', 'mobile', 'phone'], [first.name, first.phone]])).toHaveProperty('error');
    expect(parseRecipientWorkbook([['name', 'phone'], ...Array.from({ length: RECIPIENT_GROUP_MAX + 1 }, () => [first.name, first.phone])])).toHaveProperty('error');
  });

  it('creates a saved group, appends unique numbers, and treats repeated saves as no-ops', async () => {
    const input = { groupId: 'parents', newGroupName: 'Parents', recipients: [first, first] };
    expect(await saveRecipientGroupImport('school', 'operator', input)).toEqual({ groupId: 'parents', added: 1, skipped: 1, memberCount: 1 });
    expect(await saveRecipientGroupImport('school', 'operator', input)).toMatchObject({ added: 0, skipped: 2, memberCount: 1 });
    expect(await saveRecipientGroupImport('school', 'operator', { groupId: 'parents', recipients: [first, second] })).toMatchObject({ added: 1, skipped: 1, memberCount: 2 });
    expect(await getRecipientGroup('school', 'parents')).toEqual({ id: 'parents', name: 'Parents', members: [first, second] });
    expect(await getRecipientGroup('other', 'parents')).toBeNull();
    expect(await saveRecipientGroupImport('other', 'operator', { groupId: 'parents', recipients: [first] })).toHaveProperty('error');
    expect(memory.writes).toHaveLength(4);
    expect(memory.writes.every(path => path === 'organizations/school/recipientGroups/parents' || path.startsWith('auditLogs/'))).toBe(true);
  });

  it('refuses invalid, inactive or oversized writes without changing the roster', async () => {
    expect(await saveRecipientGroupImport('school', 'operator', { groupId: 'parents', newGroupName: 'Parents', recipients: [{ name: 'No phone', phone: '123' }] })).toHaveProperty('error');
    memory.docs.set('organizations/other', { status: 'suspended' });
    expect(await saveRecipientGroupImport('other', 'operator', { groupId: 'parents', newGroupName: 'Parents', recipients: [first] })).toHaveProperty('error');
    memory.docs.set('organizations/school/recipientGroups/parents', {
      name: 'Parents', members: Array.from({ length: RECIPIENT_GROUP_MAX }, (_, index) => ({ name: 'Saved', phone: '+1202555' + String(1000 + index) })),
    });
    expect(await saveRecipientGroupImport('school', 'operator', { groupId: 'parents', recipients: [first] })).toHaveProperty('error');
    expect(memory.writes).toEqual([]);
  });
});
