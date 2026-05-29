'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ADMIN_LABELS as L } from '@/lib/i18n';
import { setOtpOrgAction } from '@/lib/relayActions';

const CARD = 'var(--c-card)';
const BORDER = 'var(--c-border)';

export default function OtpSenderSetting({
  orgOptions, otpOrgId,
}: {
  orgOptions: { id: string; name: string }[];
  otpOrgId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const current = orgOptions.find(o => o.id === otpOrgId)?.name ?? otpOrgId;

  function set(id: string) {
    if (!id) return;
    setErr(null);
    start(async () => {
      const res = await setOtpOrgAction(id);
      if (res.error) setErr(res.error); else router.refresh();
    });
  }

  return (
    <div className="rounded-2xl p-6 space-y-3" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
      <div>
        <h2 className="text-sm font-bold">{L.relay.otpTitle}</h2>
        <p className="text-[13px]" style={{ color: 'var(--c-text-3)' }}>{L.relay.otpHint}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm" style={{ color: 'var(--c-text-3)' }}>
          {L.relay.otpCurrent}: <b style={{ color: 'var(--c-text)' }}>{current ?? L.relay.otpNone}</b>
        </span>
        <select
          defaultValue={otpOrgId ?? ''}
          onChange={(e) => set(e.target.value)}
          disabled={pending}
          className="rounded-lg px-3 py-2 text-sm"
          style={{ background: 'var(--c-bg)', border: `1px solid ${BORDER}`, color: 'var(--c-text)', minWidth: 260 }}
        >
          <option value="">{L.relay.otpNone}</option>
          {orgOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
      {err && <div className="text-sm" style={{ color: '#991B1B' }}>{err}</div>}
    </div>
  );
}
