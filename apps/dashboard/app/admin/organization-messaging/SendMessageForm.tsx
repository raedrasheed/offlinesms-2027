'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { OrgSendActionState } from '@/lib/orgMessagingActions';
import type { RecipientGroupSummary } from '@/lib/orgRecipientGroups';

const inputCls = 'w-full rounded-lg px-3 py-2 text-sm outline-none';
const inputStyle = { background: 'var(--c-bg)', border: '1px solid var(--c-border)', color: 'var(--c-text)' };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-5 py-2 text-sm font-bold rounded-lg transition hover:brightness-110 disabled:opacity-50"
      style={{ background: '#1F7BA8', color: '#fff' }}
    >
      {pending ? 'Sending…' : 'Send message'}
    </button>
  );
}

export default function SendMessageForm({
  action, groups, batchPath, initialGroupId = '',
}: {
  action: (prev: OrgSendActionState, data: FormData) => Promise<OrgSendActionState>;
  groups: RecipientGroupSummary[];
  batchPath?: '/activity';
  initialGroupId?: string;
}) {
  const router = useRouter();
  const [state, formAction] = useFormState(action, null);
  const ok = state && 'success' in state ? state : null;
  const [selectedGroupId, setGroupId] = useState(initialGroupId);
  const groupId = groups.some(({ id }) => id === selectedGroupId) ? selectedGroupId : '';

  // Refresh server-rendered usage + logs after a successful send.
  useEffect(() => { if (ok) router.refresh(); }, [ok, router]);

  return (
    <form action={formAction} className="space-y-4">
      {state && 'error' in state && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--c-error-bg)', border: '1px solid var(--c-error-border)', color: 'var(--c-text)' }} role="alert">
          {state.error}
        </div>
      )}
      {ok && (
        <div className="rounded-lg px-4 py-3 text-sm space-y-0.5" style={{ background: 'var(--c-success-bg)', border: '1px solid var(--c-success-border)', color: 'var(--c-text)' }} role="status">
          <p>
            Batch {batchPath ? <a className="font-mono underline" href={`${batchPath}/${encodeURIComponent(ok.batchId)}`}>{ok.batchId}</a> : <span className="font-mono">{ok.batchId}</span>} — status: <span className="font-bold capitalize">{ok.status}</span>.
          </p>
          <p>
            {ok.accepted}/{ok.total} accepted for delivery
            {ok.smsOnlyAccepted > 0 ? ` · ${ok.smsOnlyAccepted} SMS only` : ''}
            {ok.failed > 0 ? ` · ${ok.failed} failed` : ''}
            {ok.unsupported > 0 ? ` · ${ok.unsupported} unsupported recipient${ok.unsupported === 1 ? '' : 's'}` : ''}.
          </p>
          {ok.escalationScheduled ? (
            <p>SMS is scheduled in {ok.escalationDelayMinutes} min. The selected audience applies to registered recipients.</p>
          ) : null}
        </div>
      )}

      <div>
        <label htmlFor="org-send-title" className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>
          Title <span style={{ color: '#EF4444' }}>*</span>
        </label>
        <input id="org-send-title" name="title" required maxLength={80} className={inputCls} style={inputStyle} placeholder="Important notice" />
      </div>

      <div>
        <label htmlFor="org-send-body" className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>
          Body <span style={{ color: '#EF4444' }}>*</span>
        </label>
        <textarea id="org-send-body" name="body" required maxLength={500} rows={4} className={inputCls} style={inputStyle} placeholder="Message body (max 500 characters)" />
        <p className="text-[11px] mt-1" style={{ color: 'var(--c-text-3)' }}>
          If auto SMS escalation is enabled, the title and body are shortened to 320 characters before sender information is added. The complete SMS, including enabled sender information, is billed per segment; longer or Unicode text may cost more.
        </p>
      </div>

      {groups.length > 0 && <div>
        <label htmlFor="org-send-group" className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>Recipient group</label>
        <select id="org-send-group" name="recipientGroupId" value={groupId} onChange={event => setGroupId(event.target.value)} className={inputCls} style={inputStyle}>
          <option value="">Enter recipients manually</option>
          {groups.map(group => <option key={group.id} value={group.id}>{group.name} ({group.memberCount})</option>)}
        </select>
      </div>}
      {!groupId && <div>
        <label htmlFor="org-send-recipients" className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>
          Recipients <span style={{ color: '#EF4444' }}>*</span>
        </label>
        <textarea
          id="org-send-recipients"
          name="recipients"
          required
          rows={6}
          className={`${inputCls} font-mono`}
          style={inputStyle}
          placeholder={'+970591234567\nuserId-abc123\none per line — +E.164 phone or user ID (max 500)'}
        />
        <p className="text-[11px] mt-1" style={{ color: 'var(--c-text-3)' }}>
          One recipient per line: a phone in +E.164 form or an OfflineSMS user ID. Max 500 per send.
        </p>
      </div>}

      <SubmitButton />
    </form>
  );
}
