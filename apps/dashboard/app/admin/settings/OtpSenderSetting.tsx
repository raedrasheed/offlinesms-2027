'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ADMIN_LABELS as L } from '@/lib/i18n';
import { setOtpOrgAction, setOtpPolicyAction, type OtpPolicyPatch } from '@/lib/relayActions';

const CARD = 'var(--c-card)';
const BORDER = 'var(--c-border)';

export interface OtpPolicyState {
  enabled: boolean;
  emergencyStop: boolean;
  signinEnabled: boolean;
  linkEnabled: boolean;
  policyVersion: number;
}

/**
 * Verification-SMS (OTP) controls — platform admins only. Every change bumps
 * smsConfig/otp.policyVersion and cancels queued codes from the old policy.
 * These are runtime gates; each purpose also needs its deploy-time env flag.
 */
export default function OtpSenderSetting({
  orgOptions, otpOrgId, policy,
}: {
  orgOptions: { id: string; name: string }[];
  otpOrgId: string | null;
  policy: OtpPolicyState | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const current = orgOptions.find(o => o.id === otpOrgId)?.name ?? otpOrgId;

  function run(fn: () => Promise<{ error?: string }>) {
    setErr(null);
    start(async () => {
      const res = await fn();
      if (res.error) setErr(res.error); else router.refresh();
    });
  }

  // An empty selection really clears the sender now (previously ignored).
  function setOrg(id: string) {
    if (!id && !confirm(L.relay.otpClearConfirm)) return;
    run(() => setOtpOrgAction(id));
  }

  function setPolicy(patch: OtpPolicyPatch, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    run(() => setOtpPolicyAction(patch));
  }

  const sending = !!policy && policy.enabled && !policy.emergencyStop && !!otpOrgId;
  const statusText = !policy ? L.relay.otpStatusUnknown
    : policy.emergencyStop ? L.relay.otpStatusStopped
      : !policy.enabled || !otpOrgId ? L.relay.otpStatusOff
        : L.relay.otpStatusOn;

  function toggle(label: string, value: boolean, onChange: (v: boolean) => void) {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value} disabled={pending || !policy} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    );
  }

  return (
    <div className="rounded-2xl p-6 space-y-4" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
      <div>
        <h2 className="text-sm font-bold">{L.relay.otpTitle}</h2>
        <p className="text-[13px]" style={{ color: 'var(--c-text-3)' }}>{L.relay.otpHint}</p>
      </div>

      <div className="text-sm" role="status">
        {L.relay.otpStatus}: <b style={{ color: sending ? '#166534' : '#991B1B' }}>{statusText}</b>
        {policy ? <span style={{ color: 'var(--c-text-3)' }}> · v{policy.policyVersion}</span> : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm" style={{ color: 'var(--c-text-3)' }}>
          {L.relay.otpCurrent}: <b style={{ color: 'var(--c-text)' }}>{current ?? L.relay.otpNone}</b>
        </span>
        <select
          value={otpOrgId ?? ''}
          onChange={(e) => setOrg(e.target.value)}
          disabled={pending}
          className="rounded-lg px-3 py-2 text-sm"
          style={{ background: 'var(--c-bg)', border: `1px solid ${BORDER}`, color: 'var(--c-text)', minWidth: 260 }}
        >
          <option value="">{L.relay.otpNone}</option>
          {orgOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      <div className="flex flex-wrap gap-5">
        {toggle(L.relay.otpMaster, !!policy?.enabled, v => setPolicy({ enabled: v }, v ? L.relay.otpEnableConfirm : undefined))}
        {toggle(L.relay.otpSignin, !!policy?.signinEnabled, v => setPolicy({ signinEnabled: v }, v ? L.relay.otpEnableConfirm : undefined))}
        {toggle(L.relay.otpLink, !!policy?.linkEnabled, v => setPolicy({ linkEnabled: v }, v ? L.relay.otpEnableConfirm : undefined))}
      </div>

      <div>
        {policy?.emergencyStop ? (
          <button
            type="button" disabled={pending}
            onClick={() => setPolicy({ emergencyStop: false }, L.relay.otpResumeConfirm)}
            className="rounded-lg px-3 py-2 text-sm font-semibold"
            style={{ border: `1px solid ${BORDER}` }}
          >{L.relay.otpResume}</button>
        ) : (
          <button
            type="button" disabled={pending || !policy}
            onClick={() => setPolicy({ emergencyStop: true })}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-white"
            style={{ background: '#B91C1C' }}
          >{L.relay.otpStop}</button>
        )}
        <p className="text-[12px] mt-2" style={{ color: 'var(--c-text-3)' }}>{L.relay.otpStopHint}</p>
      </div>

      {err && <div className="text-sm" style={{ color: '#991B1B' }}>{err}</div>}
    </div>
  );
}
