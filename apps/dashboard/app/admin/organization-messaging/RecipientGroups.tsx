'use client';

import { useEffect, useRef, useState, useTransition, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { FileSpreadsheet, Upload } from 'lucide-react';
import type { importOrganizationRecipients } from '@/lib/orgMessagingActions';
import type { RecipientGroupSummary } from '@/lib/orgRecipientGroups';
import { parseRecipientWorkbook, RECIPIENT_GROUP_MAX, RECIPIENT_WORKBOOK_MAX_BYTES, type GroupRecipient, type WorkbookPreview } from '@/lib/recipientGroupValidation';

const field = 'w-full rounded-lg border px-3 py-2 text-sm';
const fieldStyle = { borderColor: 'var(--c-border)', background: 'var(--c-bg)', color: 'var(--c-text)' };

type Props = {
  groups: RecipientGroupSummary[];
  selected: { id: string; name: string; members: GroupRecipient[] } | null;
  organizationId: string;
  groupPath?: '/groups';
  action: (input: Parameters<typeof importOrganizationRecipients>[1]) => ReturnType<typeof importOrganizationRecipients>;
};

export default function RecipientGroups({ groups, selected, organizationId, groupPath, action }: Props) {
  const router = useRouter();
  const [target, setTarget] = useState(selected?.id ?? '');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<WorkbookPreview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reading, setReading] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const newGroupId = useRef('');
  const readSequence = useRef(0);
  const selectedId = selected?.id;

  useEffect(() => {
    if (selectedId) setTarget(selectedId);
  }, [selectedId]);

  function groupLink(id: string): Route {
    if (groupPath) return `${groupPath}?${new URLSearchParams({ group: id })}#recipient-groups` as Route;
    return `/admin/organization-messaging?${new URLSearchParams({ org: organizationId, group: id })}#recipient-groups` as Route;
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const request = ++readSequence.current;
    const file = event.target.files?.[0];
    setError('');
    setNotice('');
    setPreview(null);
    setReading(false);
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name) || file.size > RECIPIENT_WORKBOOK_MAX_BYTES) {
      setError('Choose an Excel .xlsx file up to 2 MB.');
      return;
    }
    setReading(true);
    try {
      const { readSheet } = await import('read-excel-file/browser');
      const result = parseRecipientWorkbook(await readSheet(file));
      if (request !== readSequence.current) return;
      if ('error' in result) setError(result.error);
      else setPreview(result);
    } catch {
      if (request === readSequence.current) setError('Could not read the first worksheet. Check the file and try again.');
    } finally {
      if (request === readSequence.current) setReading(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || reading || !preview?.recipients.length || preview.invalidRows.length || (!target && !name.trim())) return;
    setError('');
    setNotice('');
    const groupId = target || (newGroupId.current ||= crypto.randomUUID());
    startTransition(async () => {
      try {
        const result = await action({ groupId, ...(target ? {} : { newGroupName: name }), recipients: preview.recipients });
        if (!('groupId' in result) || !result.groupId) { setError(result.error ?? 'Could not save the group.'); return; }
        setNotice(`${result.added} added · ${result.skipped} already in the group · ${result.memberCount} total`);
        setPreview(null);
        setTarget(result.groupId);
        setName('');
        newGroupId.current = '';
        if (fileInput.current) fileInput.current.value = '';
        if (selected?.id !== result.groupId) router.replace(groupLink(result.groupId), { scroll: false });
      } catch { setError('Could not save the group. Try again.'); }
    });
  }

  return (
    <section id="recipient-groups" className="scroll-mt-4 rounded-2xl border p-6 space-y-5" style={{ background: 'var(--c-card)', borderColor: 'var(--c-border)' }}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ background: 'rgba(31,123,168,.12)', color: 'var(--c-accent, #1F7BA8)' }}><FileSpreadsheet size={20} aria-hidden /></span>
        <div>
          <h2 className="font-extrabold">Recipient groups</h2>
          <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>Save recipients for later use in the send form or API.</p>
        </div>
      </div>
      {groups.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {groups.map(group => <li key={group.id}><Link href={groupLink(group.id)} prefetch={groupPath ? false : undefined} aria-current={selected?.id === group.id ? 'true' : undefined}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:brightness-95" style={fieldStyle}>
            <span>{group.name}</span><span className="text-xs tabular-nums" style={{ color: 'var(--c-text-3)' }}>{group.memberCount}</span>
          </Link></li>)}
        </ul>
      )}
      {selected && (
        <details className="rounded-lg border px-4 py-3" style={{ borderColor: 'var(--c-border)' }}>
          <summary className="cursor-pointer text-sm font-semibold">{selected.name} · {selected.members.length} saved recipients</summary>
          <p className="my-2 text-xs break-all" style={{ color: 'var(--c-text-3)' }}>API group ID <code className="ml-1">{selected.id}</code></p>
          <RecipientTable recipients={selected.members} />
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer font-medium">Use this group with the API</summary>
            <p className="my-2">POST <code>/api/v1/org/messages/send</code> with your organization API key as a Bearer token. The existing in-app delivery and SMS escalation policy applies.</p>
            <pre className="overflow-x-auto rounded-lg p-3" style={{ background: 'var(--c-bg)' }}>{JSON.stringify({ recipientGroupId: selected.id, title: 'Reminder', body: 'Enter your message.' }, null, 2)}</pre>
          </details>
        </details>
      )}
      <form onSubmit={save} className="space-y-4">
        <fieldset disabled={pending} className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Add to
              <select value={target} onChange={event => { setTarget(event.target.value); newGroupId.current = ''; setNotice(''); }} className={`${field} mt-1`} style={fieldStyle}>
                <option value="">Create a new group</option>
                {groups.map(group => <option key={group.id} value={group.id}>{group.name} ({group.memberCount})</option>)}
              </select>
            </label>
            {!target && <label className="text-sm font-medium">Group name
              <input value={name} onChange={event => { setName(event.target.value); newGroupId.current = ''; }} required maxLength={80} className={`${field} mt-1`} style={fieldStyle} />
            </label>}
          </div>
          <div className="rounded-xl border border-dashed p-4" style={{ borderColor: 'var(--c-border)', background: 'var(--c-bg)' }}>
            <label htmlFor="org-recipient-workbook" className="flex items-center gap-2 text-sm font-semibold"><Upload size={16} aria-hidden /> Excel workbook</label>
            <input id="org-recipient-workbook" ref={fileInput} type="file" accept=".xlsx" onChange={readFile} className="mt-2 block w-full text-sm" aria-describedby="org-recipient-workbook-hint" />
            <p id="org-recipient-workbook-hint" className="mt-2 text-xs" style={{ color: 'var(--c-text-3)' }}>
              Use Name and Phone columns (الاسم، رقم الهاتف) on the first sheet. Save international numbers as text with + and the country code. Up to {RECIPIENT_GROUP_MAX} recipients per group.
            </p>
          </div>
          {preview && <div className="space-y-2">
            <p className="text-sm font-semibold">{preview.recipients.length} ready to add{preview.duplicateRows.length ? ` · ${preview.duplicateRows.length} duplicate rows omitted` : ''}</p>
            {preview.invalidRows.length > 0 && <div role="alert" className="text-sm" style={{ color: 'var(--c-text)' }}>
              <strong>Fix {preview.invalidRows.length} invalid {preview.invalidRows.length === 1 ? 'row' : 'rows'} and select the file again.</strong>
              <ul className="mt-1 list-disc pl-5">
                {preview.invalidRows.slice(0, 10).map(issue => <li key={issue.row}>Row {issue.row} · {issue.error}</li>)}
              </ul>
            </div>}
            <RecipientTable recipients={preview.recipients} />
          </div>}
        </fieldset>
        {error && <p role="alert" className="rounded-lg border px-3 py-2 text-sm" style={{ background: 'var(--c-error-bg)', borderColor: 'var(--c-error-border)' }}>{error}</p>}
        {notice && <p role="status" className="text-sm font-medium">{notice}</p>}
        <button type="submit" disabled={pending || reading || !preview?.recipients.length || !!preview.invalidRows.length || (!target && !name.trim())}
          className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50" style={{ background: '#176f96' }}>
          {pending ? 'Saving…' : reading ? 'Reading workbook…' : 'Add to group'}
        </button>
      </form>
    </section>
  );
}

function RecipientTable({ recipients }: { recipients: GroupRecipient[] }) {
  if (!recipients.length) return null;
  return <div className="max-h-64 overflow-auto rounded-lg border" style={{ borderColor: 'var(--c-border)' }}>
    <table className="w-full text-sm">
      <thead style={{ background: 'var(--c-bg)' }}><tr><th scope="col" className="px-3 py-2 text-start">Name</th><th scope="col" className="px-3 py-2 text-start">Phone</th></tr></thead>
      <tbody>{recipients.map(row => <tr key={row.phone} className="border-t" style={{ borderColor: 'var(--c-border)' }}>
        <td className="px-3 py-2 break-words" dir="auto">{row.name}</td><td className="px-3 py-2 whitespace-nowrap font-mono" dir="ltr">{row.phone}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
