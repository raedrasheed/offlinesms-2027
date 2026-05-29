'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ADMIN_LABELS as L } from '@/lib/i18n';
import { sendRelayTestAction } from '@/lib/relayActions';

const BORDER = 'var(--c-border)';
const CARD = 'var(--c-card)';

export default function SendSmsForm({
  businessId, orgOptions,
}: {
  businessId: string | null;
  orgOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [phone, setPhone] = useState('');
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function send() {
    setMsg(null); setErr(null);
    startTransition(async () => {
      const res = await sendRelayTestAction(phone, body, businessId ?? undefined);
      if (res.error) setErr(res.error);
      else { setMsg(L.relay.sendQueued); setBody(''); router.refresh(); }
    });
  }

  const box = { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 };

  return (
    <div style={box} className="space-y-3" >
      {orgOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm" style={{ color: 'var(--c-text-muted)' }}>{L.relay.selectOrg}</label>
          <select
            value={businessId ?? ''}
            onChange={(e) => router.push(e.target.value ? `/admin/relay/send?org=${e.target.value}` : '/admin/relay/send')}
            className="px-3 py-2 rounded-md text-sm"
            style={{ border: `1px solid ${BORDER}`, background: 'transparent', color: 'inherit', minWidth: 260 }}
          >
            <option value="">{L.relay.selectOrgPlaceholder}</option>
            {orgOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      )}

      {!businessId ? (
        <p className="text-sm" style={{ color: 'var(--c-text-muted)' }}>{L.relay.selectOrgHint}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={L.relay.sendPhonePlaceholder}
              className="px-3 py-2 rounded-md text-sm"
              style={{ border: `1px solid ${BORDER}`, background: 'transparent', color: 'inherit', minWidth: 220 }}
            />
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={L.relay.sendBodyPlaceholder}
              maxLength={300}
              className="px-3 py-2 rounded-md text-sm flex-1"
              style={{ border: `1px solid ${BORDER}`, background: 'transparent', color: 'inherit', minWidth: 240 }}
            />
            <button
              onClick={send}
              disabled={pending || !phone.trim() || !body.trim()}
              className="px-3 py-2 rounded-md text-sm font-medium"
              style={{ background: 'var(--c-accent, #1D6E92)', color: '#fff', opacity: pending ? 0.6 : 1 }}
            >
              {L.relay.sendBtn}
            </button>
          </div>
          {msg && <div className="text-sm" style={{ color: '#166534' }}>{msg}</div>}
          {err && <div className="text-sm" style={{ color: '#991B1B' }}>{err}</div>}
        </>
      )}
    </div>
  );
}
