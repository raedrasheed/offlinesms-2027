'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from 'react';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { RecipientGroupChange } from '@/lib/orgRecipientGroups';
import { RECIPIENT_NAME_MAX, type GroupRecipient } from '../../../lib/recipientGroupValidation';

const field = 'w-full rounded-lg border px-3 py-2 text-sm';
const button = 'rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50';
const fieldStyle = { borderColor: 'var(--c-border)', background: 'var(--c-bg)', color: 'var(--c-text)' };
const dangerStyle = { borderColor: 'var(--c-error-border)', background: 'var(--c-error-bg)', color: 'var(--c-text)' };

type Props = {
  groupId: string;
  members: GroupRecipient[];
  manageAction: (groupId: string, change: RecipientGroupChange) => Promise<{ members: GroupRecipient[] } | { error: string }>;
  onMembersChanged: () => void;
};

function searchableName(value: string): string {
  return value.normalize('NFKD').replace(/\p{Mark}|ـ/gu, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function searchablePhone(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) & 15)).replace(/[\s()+.-]/g, '');
}

export default function RecipientGroupMembers({ groupId, members, manageAction, onMembersChanged }: Props) {
  const [search, setSearch] = useState('');
  const [callingCode, setCallingCode] = useState('');
  const [selection, setSelection] = useState(() => new Map<string, string>());
  const [edit, setEdit] = useState<{ original: GroupRecipient; recipient: GroupRecipient } | null>(null);
  const [updated, setUpdated] = useState<{ previous: GroupRecipient[]; members: GroupRecipient[] } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, startTransition] = useTransition();
  const editNameInput = useRef<HTMLInputElement>(null);
  const selectAllInput = useRef<HTMLInputElement>(null);
  const original = edit?.original;
  const roster = updated?.previous === members ? updated.members : members;

  const rows = useMemo(() => roster.map(recipient => ({
    recipient,
    name: searchableName(recipient.name),
    phone: searchablePhone(recipient.phone),
    callingCode: parsePhoneNumberFromString(recipient.phone)?.countryCallingCode,
  })), [roster]);
  const codes = Array.from(new Set([
    ...rows.flatMap(row => row.callingCode ? [String(row.callingCode)] : []),
    ...(callingCode ? [callingCode] : []),
  ])).sort((a, b) => Number(a) - Number(b));
  const nameQuery = searchableName(search);
  const phoneQuery = searchablePhone(search);
  const searchByPhone = /^\d+$/.test(phoneQuery);
  const visible = rows.filter(row =>
    (!callingCode || row.callingCode === callingCode) &&
    (row.name.includes(nameQuery) || (searchByPhone && row.phone.includes(phoneQuery))),
  ).map(row => row.recipient);
  const selected = visible.filter(recipient => selection.get(recipient.phone) === recipient.name);
  const allSelected = visible.length > 0 && selected.length === visible.length;
  const someSelected = selected.length > 0 && !allSelected;

  useEffect(() => {
    if (original) editNameInput.current?.focus();
  }, [original]);

  useEffect(() => {
    if (selectAllInput.current) selectAllInput.current.indeterminate = someSelected;
  }, [someSelected]);

  function updateSelection(recipient: GroupRecipient, checked: boolean) {
    setSelection(current => {
      const next = new Map(current);
      if (checked) next.set(recipient.phone, recipient.name);
      else next.delete(recipient.phone);
      return next;
    });
  }

  function changeMembers(change: RecipientGroupChange) {
    if (pending) return;
    setError('');
    setNotice('');
    startTransition(async () => {
      try {
        const result = await manageAction(groupId, change);
        if ('error' in result) {
          setError(result.error);
          return;
        }
        setUpdated({ previous: members, members: result.members });
        setSelection(new Map());
        setEdit(null);
        setNotice(change.type === 'edit'
          ? 'Recipient updated.'
          : `${change.recipients.length} ${change.recipients.length === 1 ? 'recipient' : 'recipients'} removed from the group.`);
        onMembersChanged();
      } catch {
        setError('Could not update the group. Try again.');
      }
    });
  }

  function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (edit) changeMembers({ type: 'edit', ...edit });
  }

  function remove(recipients: GroupRecipient[]) {
    if (pending || !recipients.length) return;
    const description = recipients.length === 1
      ? `${recipients[0].name} (${recipients[0].phone})`
      : `${recipients.length} selected recipients`;
    if (window.confirm(`Remove ${description} from this group?`)) changeMembers({ type: 'delete', recipients });
  }

  return (
    <div className="space-y-3" aria-busy={pending}>
      <fieldset disabled={pending} className="min-w-0 space-y-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)]">
          <label className="text-sm font-medium">
            Search recipients
            <input type="search" dir="auto" value={search} placeholder="Name or phone number" className={`${field} mt-1`} style={fieldStyle}
              onChange={event => { setSearch(event.target.value); setSelection(new Map()); }} />
          </label>
          <label className="text-sm font-medium">
            Country calling code
            <select value={callingCode} className={`${field} mt-1`} style={fieldStyle}
              onChange={event => { setCallingCode(event.target.value); setSelection(new Map()); }}>
              <option value="">All calling codes</option>
              {codes.map(code => <option key={code} value={code}>+{code}</option>)}
            </select>
          </label>
        </div>
        {edit && (
          <form onSubmit={saveEdit} className="space-y-3 rounded-lg border p-3" style={fieldStyle}>
            <h3 className="text-sm font-semibold">Edit recipient</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium">
                Name
                <input ref={editNameInput} required dir="auto" maxLength={RECIPIENT_NAME_MAX} value={edit.recipient.name} className={`${field} mt-1`} style={fieldStyle}
                  onChange={event => setEdit({ ...edit, recipient: { ...edit.recipient, name: event.target.value } })} />
              </label>
              <label className="text-sm font-medium">
                Phone number
                <input type="tel" required dir="ltr" value={edit.recipient.phone} className={`${field} mt-1`} style={fieldStyle}
                  aria-describedby="edit-recipient-phone-hint"
                  onChange={event => setEdit({ ...edit, recipient: { ...edit.recipient, phone: event.target.value } })} />
                <span id="edit-recipient-phone-hint" className="mt-1 block text-xs" style={{ color: 'var(--c-text-3)' }}>Include the country code.</span>
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={`${button} text-white`} style={{ background: '#176f96', borderColor: '#176f96' }}>{pending ? 'Saving…' : 'Save changes'}</button>
              <button type="button" className={button} style={fieldStyle} onClick={() => { setEdit(null); setError(''); }}>Cancel</button>
            </div>
          </form>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm" role="status" style={{ color: 'var(--c-text-3)' }}>
            {visible.length} of {roster.length} shown{selected.length > 0 && ` · ${selected.length} selected`}
          </p>
          <button type="button" disabled={!selected.length} className={button} style={dangerStyle} onClick={() => remove(selected)}>Delete selected</button>
        </div>
        {visible.length > 0 ? (
          <div className="max-h-80 overflow-auto rounded-lg border" style={{ borderColor: 'var(--c-border)' }}>
            <table className="w-full text-sm" aria-label="Saved recipients">
              <thead style={{ background: 'var(--c-bg)' }}>
                <tr>
                  <th scope="col" className="w-10 px-3 py-2 text-start">
                    <input type="checkbox" aria-label="Select all shown recipients" ref={selectAllInput} checked={allSelected}
                      onChange={event => setSelection(new Map(event.target.checked ? visible.map(recipient => [recipient.phone, recipient.name]) : []))} />
                  </th>
                  <th scope="col" className="px-3 py-2 text-start">Name</th>
                  <th scope="col" className="px-3 py-2 text-start">Phone</th>
                  <th scope="col" className="px-3 py-2 text-start">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(recipient => (
                  <tr key={recipient.phone} className="border-t" style={{ borderColor: 'var(--c-border)' }}>
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Select ${recipient.name} (${recipient.phone})`}
                        checked={selection.get(recipient.phone) === recipient.name} onChange={event => updateSelection(recipient, event.target.checked)} />
                    </td>
                    <td className="min-w-28 px-3 py-2 break-words"><bdi>{recipient.name}</bdi></td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono" dir="ltr">{recipient.phone}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={button} style={fieldStyle} aria-label={`Edit ${recipient.name} (${recipient.phone})`}
                          onClick={() => { setEdit({ original: recipient, recipient }); setError(''); setNotice(''); }}>Edit</button>
                        <button type="button" className={button} style={dangerStyle} aria-label={`Delete ${recipient.name} (${recipient.phone})`}
                          onClick={() => remove([recipient])}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>{roster.length ? 'No recipients match the current filters.' : 'This group has no saved recipients.'}</p>
        )}
      </fieldset>
      {error && <p role="alert" className="rounded-lg border px-3 py-2 text-sm" style={dangerStyle}>{error}</p>}
      {notice && <p role="status" className="text-sm font-medium" style={{ color: 'var(--c-text)' }}>{notice}</p>}
    </div>
  );
}
