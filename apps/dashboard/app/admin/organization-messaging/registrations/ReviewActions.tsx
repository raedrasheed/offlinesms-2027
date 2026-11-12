'use client';

import { useActionState, useState } from 'react';
import type { OrganizationRegistrationReviewState } from '@/lib/orgRegistrationActions';
import { ORG_MONTHLY_LIMIT_MAX } from '@/lib/orgMessagingValidation';

type Decision = 'approve' | 'reject';
type ReviewAction = (state: OrganizationRegistrationReviewState, form: FormData) => Promise<OrganizationRegistrationReviewState>;

const BUTTON = 'rounded-md px-3 py-2 text-sm font-semibold transition hover:brightness-110 disabled:opacity-50';
const PRIMARY = `${BUTTON} bg-action-primary text-action-primaryFg`;
const SECONDARY = `${BUTTON} border border-[var(--c-border)] text-[var(--c-text-2)] hover:bg-[var(--c-bg)]`;
const INPUT = 'w-full rounded-md border border-[var(--c-border)] bg-[var(--c-bg)] px-2.5 py-2 text-sm text-[var(--c-text)]';

export default function ReviewActions({ approving, approve, reject }: {
  approving: boolean;
  approve: ReviewAction;
  reject: ReviewAction;
}) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const selected = approving ? 'approve' : decision;
  return (
    <div className="text-left">
      {selected ? (
        <DecisionForm key={selected} decision={selected} retry={approving}
          action={selected === 'approve' ? approve : reject}
          onCancel={approving ? undefined : () => setDecision(null)} />
      ) : (
        <div className="flex flex-wrap gap-2 md:justify-end">
          <button type="button" className={SECONDARY} onClick={() => setDecision('reject')}>
            Reject
          </button>
          <button type="button" className={PRIMARY} onClick={() => setDecision('approve')}>
            Approve
          </button>
        </div>
      )}
    </div>
  );
}

function DecisionForm({ decision, retry, action, onCancel }: {
  decision: Decision;
  retry: boolean;
  action: ReviewAction;
  onCancel?: () => void;
}) {
  const [result, submit, pending] = useActionState(action, null);
  const isApproval = decision === 'approve';
  if (result && 'success' in result) {
    return <p role="status" className="text-sm">{isApproval ? 'Organization approved.' : 'Request rejected.'}</p>;
  }
  return (
    <form action={submit} className="space-y-3">
      {isApproval ? (
        retry ? (
          <p className="text-sm text-[var(--c-text-2)]">Retry to finish setting up the approved organization.</p>
        ) : (
          <label className="block space-y-1 text-xs font-semibold text-[var(--c-text-2)]">
            <span>Monthly message limit</span>
            <input type="number" name="monthlyMessageLimit" min={1} max={ORG_MONTHLY_LIMIT_MAX}
              step={1} defaultValue={100} required className={INPUT} autoFocus />
          </label>
        )
      ) : (
        <label className="block space-y-1 text-xs font-semibold text-[var(--c-text-2)]">
          <span>Reason shown to applicant (optional)</span>
          <textarea name="reason" rows={2} maxLength={300} className={INPUT} autoFocus />
        </label>
      )}
      {result && 'error' in result && <p role="alert" className="text-sm text-red-600">{result.error}</p>}
      <div className="flex flex-wrap gap-2 md:justify-end">
        {onCancel && <button type="button" className={SECONDARY} disabled={pending} onClick={onCancel}>Cancel</button>}
        <button type="submit" className={isApproval ? PRIMARY : SECONDARY} disabled={pending}>
          {pending ? 'Saving…' : retry ? 'Retry approval' : isApproval ? 'Approve request' : 'Reject request'}
        </button>
      </div>
    </form>
  );
}
