import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRecipientWorkbook, RECIPIENT_GROUP_MAX, RECIPIENT_GROUP_NAME_MAX } from '../lib/recipientGroupValidation';
import {
  saveRecipientGroupChange, saveRecipientGroupDefinitionChange, saveRecipientGroupImport, getRecipientGroup, listRecipientGroups,
} from '../lib/orgRecipientGroups';

const memory = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  revisions: new Map<string, number>(),
  writes: [] as string[],
  queries: [] as { path: string; order: string; fields: string[] }[],
  id: 0,
}));

vi.mock('../lib/firebase-admin', () => {
  function doc(path: string) {
    const snapshot = () => ({
      id: path.split('/').at(-1),
      exists: memory.docs.has(path),
      updateTime: memory.docs.has(path) ? { seconds: 1_700_000_000, nanoseconds: memory.revisions.get(path) ?? 0 } : undefined,
      get: (key: string) => memory.docs.get(path)?.[key],
    });
    return { path, id: path.split('/').at(-1), snapshot, get: async () => snapshot(),
      collection: (name: string) => collection(path + '/' + name) };
  }
  function collection(path: string) {
    return {
      doc: (id = String(++memory.id)) => doc(path + '/' + id),
      orderBy: (order: string) => ({ select: (...fields: string[]) => ({ get: async () => {
        memory.queries.push({ path, order, fields });
        const prefix = `${path}/`;
        const docs = [...memory.docs.keys()]
          .filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
          .map(key => doc(key).snapshot());
        return { docs };
      } }) }),
    };
  }
  function write(ref: ReturnType<typeof doc>, data: Record<string, unknown>) {
    memory.writes.push(ref.path);
    memory.docs.set(ref.path, { ...memory.docs.get(ref.path), ...data });
    memory.revisions.set(ref.path, (memory.revisions.get(ref.path) ?? 0) + 1);
  }
  function remove(ref: ReturnType<typeof doc>) {
    memory.writes.push(ref.path);
    memory.docs.delete(ref.path);
  }
  return { adminDb: { collection, runTransaction: async (callback: (tx: unknown) => unknown) =>
    callback({ getAll: async (...refs: ReturnType<typeof doc>[]) => refs.map(ref => ref.snapshot()), create: write, update: write, delete: remove }) } };
});

const first = { name: 'First recipient', phone: '+12025550123' };
const second = { name: 'Second recipient', phone: '+12025550124' };

beforeEach(() => {
  memory.docs.clear();
  memory.revisions.clear();
  memory.writes.length = 0;
  memory.queries.length = 0;
  memory.docs.set('organizations/school', { status: 'active' });
  memory.docs.set('organizations/other', { status: 'active' });
});

describe('Excel recipient import', () => {
  it('reads Arabic columns, accepts numeric cells and deduplicates normalized numbers', () => {
    expect(parseRecipientWorkbook([
      ['رقم الهاتف', 'الإسم'],
      ['+١ ٢٠٢-٥٥٥-٠١٢٣', 'First recipient'],
      [null, null],
      ['١٢٠٢٥٥٥٠١٢٣', 'Duplicate without plus'],
      [12025550124, 'Second recipient'],
      ['+12025550124', 'Duplicate of a numeric cell'],
    ])).toEqual({
      recipients: [first, second],
      duplicateRows: [4, 6],
      invalidRows: [],
    });
  });

  it('adds plus to international digits without guessing a country or repairing digits', () => {
    expect(parseRecipientWorkbook([
      ['Name', 'Phone'],
      ['First recipient', '12025550123'],
      ['Local number', '0595550123'],
      ['Fraction', 12025550124.5],
      ['Negative', -12025550124],
      ['Too long', 1202555012345678],
      ['Scientific text', '1.2025550124E+10'],
      ['Extra trunk digit', '4402079460123'],
    ])).toEqual({
      recipients: [first],
      duplicateRows: [],
      invalidRows: [3, 4, 5, 6, 7, 8].map(row => ({ row, error: expect.any(String) })),
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
    expect(await getRecipientGroup('school', 'parents')).toEqual({ id: 'parents', name: 'Parents', members: [first, second], revision: '1700000000:2' });
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

describe('saved recipient management', () => {
  const groupPath = 'organizations/school/recipientGroups/parents';
  const third = { name: 'Third recipient', phone: '+12025550125' };

  beforeEach(() => {
    memory.docs.set(groupPath, { name: 'Parents', memberCount: 3, members: [first, second, third] });
  });

  it('changes a name or phone number and retains the rest of the group', async () => {
    const renamed = { ...first, name: 'الاسم الجديد' };
    expect(await saveRecipientGroupChange('school', 'operator', 'parents', { type: 'edit', original: first, recipient: renamed }))
      .toEqual({ members: [renamed, second, third] });
    const changed = { ...renamed, phone: '+12025550126' };
    expect(await saveRecipientGroupChange('school', 'operator', 'parents', {
      type: 'edit', original: renamed, recipient: { ...changed, phone: '12025550126' },
    })).toEqual({ members: [changed, second, third] });
    expect(memory.docs.get(groupPath)).toMatchObject({ memberCount: 3, members: [changed, second, third] });
    const audits = [...memory.docs.entries()].filter(([path]) => path.startsWith('auditLogs/')).map(([, doc]) => doc);
    expect(audits).toHaveLength(2);
    for (const audit of audits) {
      expect(audit).toMatchObject({ action: 'organization.recipient_group.recipient_updated', targetId: 'parents' });
      expect(audit.metadata).toEqual({ organizationId: 'school', updated: 1 });
    }
  });

  it('removes selected recipients individually or in bulk and keeps the empty group', async () => {
    expect(await saveRecipientGroupChange('school', 'operator', 'parents', { type: 'delete', recipients: [second] }))
      .toEqual({ members: [first, third] });
    expect(memory.docs.get(groupPath)).toMatchObject({ memberCount: 2 });
    expect(await saveRecipientGroupChange('school', 'operator', 'parents', { type: 'delete', recipients: [first, first, third] }))
      .toEqual({ members: [] });
    expect(memory.docs.get(groupPath)).toMatchObject({ memberCount: 0 });
    expect(await getRecipientGroup('school', 'parents')).toEqual({ id: 'parents', name: 'Parents', members: [], revision: '1700000000:2' });
    const audits = [...memory.docs.entries()].filter(([path]) => path.startsWith('auditLogs/')).map(([, doc]) => doc);
    expect(audits.map(audit => audit.metadata)).toEqual([{ organizationId: 'school', removed: 1 }, { organizationId: 'school', removed: 2 }]);
  });

  it('rejects duplicate or invalid edits and applies no part of a stale bulk deletion', async () => {
    const edit = { type: 'edit' as const, original: first };
    expect(await saveRecipientGroupChange('school', 'operator', 'parents', { ...edit, recipient: { ...first, phone: second.phone } }))
      .toEqual({ error: 'This phone number is already in the group.' });
    expect(await saveRecipientGroupChange('school', 'operator', 'parents', { ...edit, recipient: { ...first, phone: '0595550123' } }))
      .toHaveProperty('error');
    const stale = { ...first, name: 'Previous name' };
    expect(await saveRecipientGroupChange('school', 'operator', 'parents', { ...edit, original: stale, recipient: first }))
      .toHaveProperty('error');
    expect(await saveRecipientGroupChange('school', 'operator', 'parents', { type: 'delete', recipients: [second, stale] }))
      .toHaveProperty('error');
    expect(await saveRecipientGroupChange('other', 'operator', 'parents', { type: 'delete', recipients: [first] }))
      .toEqual({ error: 'Group not found.' });
    expect(memory.docs.get(groupPath)?.members).toEqual([first, second, third]);
    expect(memory.writes).toEqual([]);
  });
});

describe('saved recipient group definition management', () => {
  const groupPath = 'organizations/school/recipientGroups/parents';
  const otherGroupPath = 'organizations/other/recipientGroups/parents';
  const revision = '1700000000:0';

  beforeEach(() => {
    memory.docs.set(groupPath, { name: 'Parents', memberCount: 1, members: [first], createdBy: 'creator' });
    memory.docs.set(otherGroupPath, { name: 'Other group', memberCount: 1, members: [second] });
  });

  it('lists scoped group metadata with a revision that can be used to rename directly', async () => {
    const groups = await listRecipientGroups('school');
    expect(groups).toEqual([{ id: 'parents', name: 'Parents', memberCount: 1, revision }]);
    expect(memory.queries).toEqual([
      { path: 'organizations/school/recipientGroups', order: 'name', fields: ['name', 'memberCount'] },
    ]);
    const [group] = groups;
    expect(await saveRecipientGroupDefinitionChange('school', 'operator', group.id, {
      type: 'rename', revision: group.revision, name: 'Staff',
    })).toEqual({ success: true });
    expect(await listRecipientGroups('school')).toEqual([
      { id: 'parents', name: 'Staff', memberCount: 1, revision: '1700000000:1' },
    ]);
  });

  it('renames a group in place and rejects a deletion based on its previous revision', async () => {
    expect(await saveRecipientGroupDefinitionChange('school', 'operator', 'parents', {
      type: 'rename', revision, name: ' أولياء الأمور ',
    })).toEqual({ success: true });
    expect(await getRecipientGroup('school', 'parents')).toEqual({
      id: 'parents', name: 'أولياء الأمور', members: [first], revision: '1700000000:1',
    });
    expect(memory.docs.get(groupPath)).toMatchObject({ memberCount: 1, createdBy: 'creator' });
    expect(await saveRecipientGroupDefinitionChange('school', 'operator', 'parents', { type: 'delete', revision }))
      .toEqual({ error: 'The group changed. Refresh the group and try again.' });
    expect(memory.docs.get(otherGroupPath)?.name).toBe('Other group');
    const audits = [...memory.docs.entries()].filter(([path]) => path.startsWith('auditLogs/')).map(([, doc]) => doc);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'organization.recipient_group.renamed', targetId: 'parents', actorUid: 'operator' });
    expect(audits[0].metadata).toEqual({ organizationId: 'school' });
  });

  it('deletes only the selected group and keeps message history and other organizations’ groups', async () => {
    const historyPath = 'organizationMessageBatches/old-send';
    const history = { organizationId: 'school', recipientGroupName: 'Parents' };
    memory.docs.set(historyPath, history);

    expect(await saveRecipientGroupDefinitionChange('school', 'operator', 'parents', { type: 'delete', revision }))
      .toEqual({ success: true });
    expect(await getRecipientGroup('school', 'parents')).toBeNull();
    expect(memory.docs.get(otherGroupPath)?.members).toEqual([second]);
    expect(memory.docs.get(historyPath)).toEqual(history);
    expect(await saveRecipientGroupDefinitionChange('school', 'operator', 'parents', { type: 'delete', revision }))
      .toEqual({ error: 'Group not found.' });
    const audits = [...memory.docs.entries()].filter(([path]) => path.startsWith('auditLogs/')).map(([, doc]) => doc);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'organization.recipient_group.deleted', targetId: 'parents' });
    expect(audits[0].metadata).toEqual({ organizationId: 'school' });
  });

  it('rejects invalid names, stale roster revisions and inactive organizations', async () => {
    for (const name of ['  ', 'x'.repeat(RECIPIENT_GROUP_NAME_MAX + 1)]) {
      expect(await saveRecipientGroupDefinitionChange('school', 'operator', 'parents', { type: 'rename', revision, name }))
        .toHaveProperty('error');
    }
    expect(await saveRecipientGroupDefinitionChange('school', 'operator', 'parents', { type: 'delete', revision: '' }))
      .toHaveProperty('error');
    await saveRecipientGroupImport('school', 'operator', { groupId: 'parents', recipients: [second] });
    const writes = [...memory.writes];
    expect(await saveRecipientGroupDefinitionChange('school', 'operator', 'parents', { type: 'delete', revision }))
      .toEqual({ error: 'The group changed. Refresh the group and try again.' });
    memory.docs.set('organizations/other', { status: 'suspended' });
    expect(await saveRecipientGroupDefinitionChange('other', 'operator', 'parents', { type: 'delete', revision }))
      .toEqual({ error: 'This organization is not active.' });
    expect(memory.writes).toEqual(writes);
  });
});
