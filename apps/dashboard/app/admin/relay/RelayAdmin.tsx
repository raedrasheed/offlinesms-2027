'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ADMIN_LABELS as L } from '@/lib/i18n';
import {
  createRelayPairingCodeAction, setRelayDeviceStatusAction, revokeRelayDeviceAction,
  setRelayModeAction,
} from '@/lib/relayActions';

export type RelayDeviceView = {
  deviceId: string;
  businessId: string;
  label: string;
  status: string;
  lastHeartbeatAt: number | null;
  appVersion: string | null;
  manufacturer: string | null;
  model: string | null;
  simInfo: Array<{ carrierName: string | null; slotIndex: number | null }>;
  sentToday: number;
  failedToday: number;
  deliveredToday: number;
  lastError: string | null;
};
export type RelayOrgStatus = { mode: 'http' | 'relay' | 'hybrid'; relayEnabled: boolean };

const ONLINE_WINDOW_MS = 90_000;
const CARD = 'var(--c-card)';
const BORDER = 'var(--c-border)';

function relativeTime(ms: number | null): string {
  if (!ms) return L.relay.never;
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString();
}

function liveStatus(d: RelayDeviceView): { text: string; color: string } {
  if (d.status === 'revoked') return { text: L.relay.revoked, color: '#991B1B' };
  if (d.status === 'paused') return { text: L.relay.paused, color: '#92400E' };
  const online = d.lastHeartbeatAt != null && Date.now() - d.lastHeartbeatAt < ONLINE_WINDOW_MS;
  return online ? { text: L.relay.online, color: '#166534' } : { text: L.relay.offline, color: '#6B7280' };
}

export default function RelayAdmin({
  devices, orgStatus, businessId, canManage, fetchError, queueHealth, healthyDevices, orgOptions,
}: {
  devices: RelayDeviceView[];
  orgStatus: RelayOrgStatus;
  businessId: string | null;
  canManage: boolean;
  fetchError: string | null;
  queueHealth: Record<string, number>;
  healthyDevices: number;
  orgOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const modeLabel = orgStatus.mode === 'relay' ? L.relay.modeRelay
    : orgStatus.mode === 'hybrid' ? L.relay.modeHybrid : L.relay.modeHttp;

  function createCode() {
    setErr(null); setCode(null); setCopied(false);
    startTransition(async () => {
      const res = await createRelayPairingCodeAction(businessId ?? undefined);
      if (res.error) setErr(res.error); else if (res.code) setCode(res.code);
    });
  }
  function doStatus(deviceId: string, status: 'active' | 'paused') {
    setErr(null);
    startTransition(async () => {
      const res = await setRelayDeviceStatusAction(deviceId, status);
      if (res.error) setErr(res.error); else router.refresh();
    });
  }
  function doRevoke(deviceId: string) {
    if (!window.confirm(L.relay.revokeConfirm)) return;
    setErr(null);
    startTransition(async () => {
      const res = await revokeRelayDeviceAction(deviceId);
      if (res.error) setErr(res.error); else router.refresh();
    });
  }
  function copy() {
    if (!code) return;
    navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }
  function setMode(mode: 'http' | 'relay' | 'hybrid') {
    setErr(null);
    startTransition(async () => {
      const res = await setRelayModeAction(mode, businessId ?? undefined);
      if (res.error) setErr(res.error); else router.refresh();
    });
  }

  const box = { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16 };
  const currentMode: 'http' | 'relay' | 'hybrid' = orgStatus.mode;
  const showNoDevicesWarning = orgStatus.relayEnabled && healthyDevices === 0;
  const qh = [
    ['qQueued', queueHealth.queued], ['qClaimed', queueHealth.claimed], ['qSending', queueHealth.sending],
    ['qSent', queueHealth.sent], ['qDelivered', queueHealth.delivered], ['qFailed', queueHealth.failed],
    ['qExpired', queueHealth.expired],
  ] as const;

  return (
    <div className="space-y-4">
      {orgOptions.length > 0 && (
        <div style={box} className="flex flex-wrap items-center gap-3">
          <label className="text-sm" style={{ color: 'var(--c-text-muted)' }}>{L.relay.selectOrg}</label>
          <select
            value={businessId ?? ''}
            onChange={(e) => router.push(e.target.value ? `/admin/relay?org=${e.target.value}` : '/admin/relay')}
            className="px-3 py-2 rounded-md text-sm"
            style={{ border: `1px solid ${BORDER}`, background: 'var(--c-bg, transparent)', color: 'inherit', minWidth: 260 }}
          >
            <option value="">{L.relay.selectOrgPlaceholder}</option>
            {orgOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      )}

      {/* Org relay status + create code */}
      <div style={box} className="flex flex-wrap items-center gap-4 justify-between">
        <div>
          <div className="text-sm" style={{ color: 'var(--c-text-muted)' }}>{L.relay.orgStatus}</div>
          <div className="font-medium">
            {orgStatus.relayEnabled ? L.relay.enabled : L.relay.disabled} · {L.relay.mode}: {modeLabel}
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <button onClick={createCode} disabled={pending}
              className="px-3 py-2 rounded-md text-sm font-medium"
              style={{ background: 'var(--c-accent, #1D6E92)', color: '#fff', opacity: pending ? 0.6 : 1 }}>
              {L.relay.createCode}
            </button>
          </div>
        )}
      </div>

      {!businessId && canManage && (
        <p className="text-xs" style={{ color: 'var(--c-text-muted)' }}>{L.relay.selectOrgHint}</p>
      )}

      {canManage && businessId && (
        <div style={box} className="flex flex-wrap items-center gap-2">
          <span className="text-sm" style={{ color: 'var(--c-text-muted)' }}>{L.relay.setMode}:</span>
          {([['http', L.relay.modeHttpOpt], ['relay', L.relay.modeRelayOpt], ['hybrid', L.relay.modeHybridOpt]] as const).map(([m, lbl]) => (
            <button key={m} onClick={() => setMode(m as 'http' | 'relay' | 'hybrid')} disabled={pending}
              className="px-3 py-1.5 rounded-md text-sm"
              style={{ border: `1px solid ${BORDER}`, background: currentMode === m ? 'var(--c-accent, #1D6E92)' : 'transparent', color: currentMode === m ? '#fff' : 'inherit' }}>
              {lbl}
            </button>
          ))}
        </div>
      )}

      {showNoDevicesWarning && (
        <div style={{ ...box, borderColor: '#FCD34D', background: '#FEF3C7', color: '#92400E' }}>{L.relay.noHealthyDevices}</div>
      )}

      {businessId && (
        <div style={box}>
          <div className="text-sm mb-2" style={{ color: 'var(--c-text-muted)' }}>
            {L.relay.queueHealth} · {L.relay.healthyDevices}: {healthyDevices}
          </div>
          <div className="grid grid-cols-3 md:grid-cols-7 gap-2 text-center">
            {qh.map(([k, v]) => (
              <div key={k} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 8 }}>
                <div className="text-lg font-semibold">{v ?? 0}</div>
                <div className="text-xs" style={{ color: 'var(--c-text-muted)' }}>{(L.relay as Record<string, string>)[k]}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {code && (
        <div style={box} className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm" style={{ color: 'var(--c-text-muted)' }}>{L.relay.codeReady}</div>
            <div className="text-2xl font-mono tracking-widest">{code}</div>
          </div>
          <button onClick={copy} className="px-3 py-2 rounded-md text-sm" style={{ border: `1px solid ${BORDER}` }}>
            {copied ? L.relay.copied : L.relay.copy}
          </button>
        </div>
      )}

      {(err || fetchError) && (
        <div style={{ ...box, borderColor: '#FCA5A5', background: '#FEF2F2', color: '#991B1B' }}>{err || fetchError}</div>
      )}

      {devices.length === 0 ? (
        <div style={box} className="text-sm" >{L.relay.noDevices}</div>
      ) : (
        <div className="space-y-3">
          {devices.map(d => {
            const s = liveStatus(d);
            return (
              <div key={d.deviceId} style={box} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{d.label}</div>
                  <span className="text-xs px-2 py-1 rounded-full" style={{ background: '#0000000d', color: s.color }}>
                    ● {s.text}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-sm" style={{ color: 'var(--c-text-muted)' }}>
                  <div>{L.relay.lastSeen}: {relativeTime(d.lastHeartbeatAt)}</div>
                  <div>{L.relay.app}: {d.appVersion ?? '—'}</div>
                  <div>{L.relay.device}: {[d.manufacturer, d.model].filter(Boolean).join(' ') || '—'}</div>
                  <div>{L.relay.sim}: {d.simInfo.map(s => s.carrierName).filter(Boolean).join(', ') || '—'}</div>
                  <div>{L.relay.today}: {d.sentToday} / {d.failedToday} / {d.deliveredToday}</div>
                  {d.lastError && <div className="text-red-600">{L.relay.lastError}: {d.lastError}</div>}
                </div>
                {canManage && d.status !== 'revoked' && (
                  <div className="flex gap-2 pt-1">
                    {d.status === 'paused' ? (
                      <button onClick={() => doStatus(d.deviceId, 'active')} disabled={pending}
                        className="px-3 py-1.5 rounded-md text-sm" style={{ border: `1px solid ${BORDER}` }}>{L.relay.resume}</button>
                    ) : (
                      <button onClick={() => doStatus(d.deviceId, 'paused')} disabled={pending}
                        className="px-3 py-1.5 rounded-md text-sm" style={{ border: `1px solid ${BORDER}` }}>{L.relay.pause}</button>
                    )}
                    <button onClick={() => doRevoke(d.deviceId)} disabled={pending}
                      className="px-3 py-1.5 rounded-md text-sm" style={{ border: '1px solid #FCA5A5', color: '#991B1B' }}>{L.relay.revoke}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
