'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { OrgGroupMessagePreview, OrgSendActionState } from '@/lib/orgMessagingActions';
import type { RecipientGroupSummary } from '@/lib/orgRecipientGroups';

const inputCls = 'w-full rounded-lg px-3 py-2 text-sm outline-none';
const inputStyle = { background: 'var(--c-bg)', border: '1px solid var(--c-border)', color: 'var(--c-text)' };
type GroupMessageReview = { groupId: string } & (
  | { status: 'loading' }
  | { status: 'ready'; preview: Exclude<OrgGroupMessagePreview, { error: string }> }
  | { status: 'error'; message: string }
);

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="px-5 py-2 text-sm font-bold rounded-lg transition hover:brightness-110 disabled:opacity-50"
      style={{ background: '#1F7BA8', color: '#fff' }}
    >
      {pending ? 'Sending…' : 'Send message'}
    </button>
  );
}

export default function SendMessageForm({
  action, groups, batchPath, initialGroupId = '', previewGroupMessages,
}: {
  action: (prev: OrgSendActionState, data: FormData) => Promise<OrgSendActionState>;
  groups: RecipientGroupSummary[];
  batchPath?: '/activity';
  initialGroupId?: string;
  previewGroupMessages?: (groupId: string) => Promise<OrgGroupMessagePreview>;
}) {
  const router = useRouter();
  const [state, formAction] = useFormState(action, null);
  const ok = state && 'success' in state ? state : null;
  const [selectedGroupId, setGroupId] = useState(initialGroupId);
  const [groupReview, setGroupReview] = useState<GroupMessageReview | null>(null);
  const previewRequest = useRef(0);
  const selectedGroup = groups.find(({ id }) => id === selectedGroupId);
  const groupId = selectedGroup?.id ?? '';
  const review = groupReview?.groupId === groupId ? groupReview : null;
  const preview = review?.status === 'ready' ? review.preview : null;
  const canUseExcelMessages = !!previewGroupMessages && (review !== null || (selectedGroup?.personalizedCount ?? 0) > 0);
  const bodyRequired = preview?.members.some(({ message }) => !message) ?? true;

  // Refresh server-rendered usage + logs after a successful send.
  useEffect(() => {
    if (!ok) return;
    previewRequest.current++;
    setGroupReview(null);
    router.refresh();
  }, [ok, router]);

  function clearGroupReview() {
    previewRequest.current++;
    setGroupReview(null);
  }

  async function loadGroupMessages() {
    if (!previewGroupMessages || !groupId) return;
    const request = ++previewRequest.current;
    setGroupReview({ groupId, status: 'loading' });
    try {
      const result = await previewGroupMessages(groupId);
      if (request !== previewRequest.current) return;
      setGroupReview('error' in result
        ? { groupId, status: 'error', message: result.error }
        : { groupId, status: 'ready', preview: result });
    } catch {
      if (request === previewRequest.current) {
        setGroupReview({ groupId, status: 'error', message: 'Could not load the group messages.' });
      }
    }
  }

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
          {review ? 'Common message' : 'Body'}{bodyRequired && <span style={{ color: '#EF4444' }}> *</span>}
        </label>
        <textarea id="org-send-body" name="body" required={bodyRequired} maxLength={500} rows={4} className={inputCls} style={inputStyle}
          placeholder={review ? 'Used for recipients without an Excel message' : 'Message body (max 500 characters)'} />
        <p className="text-[11px] mt-1" style={{ color: 'var(--c-text-3)' }}>
          If auto SMS escalation is enabled, the title and body are shortened to 320 characters before sender information is added. The complete SMS, including enabled sender information, is billed per segment; longer or Unicode text may cost more.
        </p>
      </div>

      {groups.length > 0 && <div>
        <label htmlFor="org-send-group" className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>Recipient group</label>
        <select id="org-send-group" name="recipientGroupId" value={groupId} className={inputCls} style={inputStyle}
          onChange={event => { setGroupId(event.target.value); clearGroupReview(); }}>
          <option value="">Enter recipients manually</option>
          {groups.map(group => <option key={group.id} value={group.id}>{group.name} ({group.memberCount})</option>)}
        </select>
      </div>}
      {canUseExcelMessages && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" name="useGroupMessages" value="true" checked={review !== null}
              onChange={event => { if (event.target.checked) void loadGroupMessages(); else clearGroupReview(); }} />
            Use messages from Excel
          </label>
          {review?.status === 'loading' && <p role="status" className="text-sm">Loading group messages…</p>}
          {review?.status === 'error' && <p role="alert" className="text-sm">{review.message}</p>}
          {preview && (
            <>
              <input type="hidden" name="recipientGroupRevision" value={preview.revision} />
              <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>Review the messages before sending. Rows marked Common message use the text above.</p>
              <div className="max-h-72 overflow-auto rounded-lg" style={inputStyle}>
                <table aria-label="Group message preview" className="w-full text-sm">
                  <thead><tr>
                    <th scope="col" className="px-3 py-2 text-start">Recipient</th>
                    <th scope="col" className="px-3 py-2 text-start">Message</th>
                  </tr></thead>
                  <tbody>
                    {preview.members.map(member => (
                      <tr key={member.phone} className="border-t" style={{ borderColor: 'var(--c-border)' }}>
                        <th scope="row" className="px-3 py-2 text-start font-medium">
                          <bdi>{member.name}</bdi>
                          <span className="block whitespace-nowrap font-mono text-xs" dir="ltr">{member.phone}</span>
                        </th>
                        <td className="min-w-40 whitespace-pre-wrap break-words px-3 py-2" dir="auto">{member.message ?? 'Common message'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {review && review.status !== 'loading' && (
            <button type="button" onClick={() => void loadGroupMessages()} className="text-sm font-medium underline underline-offset-4">Refresh preview</button>
          )}
        </div>
      )}
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

      <SubmitButton disabled={review !== null && !preview} />
    </form>
  );
}
