'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ADMIN_LABELS as L } from '@/lib/i18n';
import { COUNTRY_OPTIONS, flagEmoji } from '@/lib/phoneCountry';
import {
  createRelayPairingCodeAction, setRelayDeviceStatusAction, revokeRelayDeviceAction,
  setRelayModeAction, sendRelayTestAction, setRelayCountriesAction, setRelayCapsAction,
} from '@/lib/relayActions';
import { RELAY_CAP_BOUNDS, type RelayCaps } from '@/lib/otpLimits';

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
  allowedCountryCodes: string[];
  countryRoutingEnabled: boolean;
  /** Effective send caps (stored values over the functions' defaults). */
  caps: RelayCaps;
};
export type RelayOrgStatus = { mode: 'http' | 'relay' | 'hybrid'; relayEnabled: boolean };
export type CoverageRow = { country: string; active: number; offline: number; available: boolean };

const ONLINE_WINDOW_MS = 90_000;
const CARD = 'var(--c-card)';
const BORDER = 'var(--c-border)';

function relativeTime(ms: number | null, now: number | null): string {
  if (!ms) return L.relay.never;
  if (now == null) return '…';
  const diff = now - ms;
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString();
}

type Live = { key: 'online' | 'offline' | 'revoked' | 'paused'; text: string; color: string };
function liveStatus(d: RelayDeviceView, now: number | null): Live {
  if (d.status === 'revoked') return { key: 'revoked', text: L.relay.revoked, color: '#991B1B' };
  if (d.status === 'paused') return { key: 'paused', text: L.relay.paused, color: '#92400E' };
  const online = now != null && d.lastHeartbeatAt != null && now - d.lastHeartbeatAt < ONLINE_WINDOW_MS;
  return online
    ? { key: 'online', text: L.relay.online, color: '#166534' }
    : { key: 'offline', text: L.relay.offline, color: '#6B7280' };
}

/** Compact country selector: removable chips + an add dropdown. */
function CountryPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const selected = new Set(value);
  const remaining = COUNTRY_OPTIONS.filter(c => !selected.has(c.iso));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.length === 0 && <span className="text-xs" style={{ color: '#92400E' }}>No countries selected</span>}
      {value.map(iso => (
        <span key={iso} className="text-xs px-2 py-1 rounded-full inline-flex items-center gap-1" style={{ background: '#0000000d' }}>
          {flagEmoji(iso)} {iso}
          <button onClick={() => onChange(value.filter(v => v !== iso))} style={{ color: '#991B1B' }} aria-label={`remove ${iso}`}>✕</button>
        </span>
      ))}
      <select
        value=""
        onChange={e => { if (e.target.value) onChange([...value, e.target.value].sort()); }}
        className="px-2 py-1 rounded-md text-xs"
        style={{ border: `1px solid ${BORDER}`, background: 'transparent', color: 'inherit' }}
      >
        <option value="">+ add country</option>
        {remaining.map(c => <option key={c.iso} value={c.iso}>{c.iso} — {c.name}</option>)}
      </select>
    </div>
  );
}

export default function RelayAdmin({
  devices, orgStatus, businessId, canManage, isPlatform, fetchError, queueHealth, healthyDevices, orgOptions, coverage,
}: {
  devices: RelayDeviceView[];
  orgStatus: RelayOrgStatus;
  businessId: string | null;
  canManage: boolean;
  /** Platform admins (no organization scope) may change send caps. */
  isPlatform: boolean;
  fetchError: string | null;
  queueHealth: Record<string, number>;
  healthyDevices: number;
  orgOptions: { id: string; name: string }[];
  coverage: CoverageRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sendPhone, setSendPhone] = useState('');
  const [sendBody, setSendBody] = useState('');
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  // Country UI state.
  const [pairCountries, setPairCountries] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCodes, setEditCodes] = useState<string[]>([]);
  const [fStatus, setFStatus] = useState<'all' | 'online' | 'offline' | 'revoked'>('all');
  const [fCountry, setFCountry] = useState('');
  const [fNoCountries, setFNoCountries] = useState(false);
  const [capsId, setCapsId] = useState<string | null>(null);
  const [capsDraft, setCapsDraft] = useState<Record<keyof RelayCaps, string>>({ maxPerMinute: '', maxPerHour: '', maxPerDay: '' });

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  function sendTest() {
    setSendMsg(null); setSendErr(null);
    startTransition(async () => {
      const res = await sendRelayTestAction(sendPhone, sendBody, businessId ?? undefined);
      if (res.error) setSendErr(res.error);
      else { setSendMsg(L.relay.sendQueued); setSendBody(''); router.refresh(); }
    });
  }

  const modeLabel = orgStatus.mode === 'relay' ? L.relay.modeRelay
    : orgStatus.mode === 'hybrid' ? L.relay.modeHybrid : L.relay.modeHttp;

  function createCode() {
    setErr(null); setCode(null); setCopied(false);
    if (pairCountries.length === 0) { setErr('Select at least one country for this relay before creating a code.'); return; }
    startTransition(async () => {
      const res = await createRelayPairingCodeAction(businessId ?? undefined, pairCountries);
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
  function startEdit(d: RelayDeviceView) { setEditingId(d.deviceId); setEditCodes(d.allowedCountryCodes); setErr(null); }
  function saveCountries(d: RelayDeviceView) {
    const removing = d.allowedCountryCodes.filter(c => !editCodes.includes(c));
    const live = liveStatus(d, now);
    if (removing.length > 0 && live.key === 'online' &&
        !window.confirm(`Remove ${removing.join(', ')} from this active relay? In-flight routing to ${removing.join(', ')} will stop.`)) {
      return;
    }
    setErr(null);
    startTransition(async () => {
      const res = await setRelayCountriesAction(d.deviceId, editCodes);
      if (res.error) setErr(res.error); else { setEditingId(null); router.refresh(); }
    });
  }
  function startCaps(d: RelayDeviceView) {
    setCapsId(d.deviceId); setErr(null);
    setCapsDraft({ maxPerMinute: String(d.caps.maxPerMinute), maxPerHour: String(d.caps.maxPerHour), maxPerDay: String(d.caps.maxPerDay) });
  }
  function saveCaps(d: RelayDeviceView) {
    const caps = {
      maxPerMinute: Number(capsDraft.maxPerMinute), maxPerHour: Number(capsDraft.maxPerHour), maxPerDay: Number(capsDraft.maxPerDay),
    };
    setErr(null);
    startTransition(async () => {
      const res = await setRelayCapsAction(d.deviceId, caps);
      if (res.error) setErr(res.error); else { setCapsId(null); router.refresh(); }
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

  const noCountryCount = devices.filter(d => !d.countryRoutingEnabled || d.allowedCountryCodes.length === 0).length;
  const countriesWithoutCoverage = coverage.filter(c => !c.available).map(c => c.country);

  // Apply filters.
  const filtered = useMemo(() => devices.filter(d => {
    const live = liveStatus(d, now);
    if (fStatus === 'online' && live.key !== 'online') return false;
    if (fStatus === 'offline' && live.key !== 'offline' && live.key !== 'paused') return false;
    if (fStatus === 'revoked' && live.key !== 'revoked') return false;
    if (fNoCountries && d.countryRoutingEnabled && d.allowedCountryCodes.length > 0) return false;
    if (fCountry && !d.allowedCountryCodes.includes(fCountry)) return false;
    return true;
  }), [devices, now, fStatus, fCountry, fNoCountries]);

  const allCountries = useMemo(
    () => [...new Set(devices.flatMap(d => d.allowedCountryCodes))].sort(),
    [devices],
  );

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
      </div>

      {/* Create pairing code — requires selecting the relay's countries. */}
      {canManage && businessId && (
        <div style={box} className="space-y-2">
          <div className="font-medium">{L.relay.createCode}</div>
          <div className="text-xs" style={{ color: 'var(--c-text-muted)' }}>
            Choose the countries this relay is allowed to send to (required). It can be edited later.
          </div>
          <CountryPicker value={pairCountries} onChange={setPairCountries} />
          <button onClick={createCode} disabled={pending || pairCountries.length === 0}
            className="px-3 py-2 rounded-md text-sm font-medium"
            style={{ background: 'var(--c-accent, #1D6E92)', color: '#fff', opacity: (pending || pairCountries.length === 0) ? 0.6 : 1 }}>
            {L.relay.createCode}
          </button>
        </div>
      )}

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

      {/* Migration warning: relays without configured countries are blocked. */}
      {noCountryCount > 0 && (
        <div style={{ ...box, borderColor: '#FCD34D', background: '#FEF3C7', color: '#92400E' }}>
          {noCountryCount} relay(s) have no enabled countries and will not be used for sending until countries are configured.
          <span dir="rtl" className="block mt-1">يوجد relay بدون دول مفعلة. لن يتم استخدامه للإرسال حتى يتم تحديد الدول.</span>
        </div>
      )}

      {/* Coverage view */}
      {businessId && coverage.length > 0 && (
        <div style={box}>
          <div className="text-sm font-medium mb-2">Relay coverage by country</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--c-text-muted)' }} className="text-left">
                  <th className="py-1 pr-4">Country</th><th className="py-1 pr-4 text-right">Active</th>
                  <th className="py-1 pr-4 text-right">Offline</th><th className="py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {coverage.map(c => (
                  <tr key={c.country} style={{ borderTop: `1px solid ${BORDER}` }}>
                    <td className="py-1 pr-4">{flagEmoji(c.country)} {c.country}</td>
                    <td className="py-1 pr-4 text-right">{c.active}</td>
                    <td className="py-1 pr-4 text-right">{c.offline}</td>
                    <td className="py-1" style={{ color: c.available ? '#166534' : '#991B1B' }}>
                      {c.available ? 'Available' : 'No relay'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {countriesWithoutCoverage.length > 0 && (
            <div className="mt-3 text-sm" style={{ color: '#991B1B' }}>
              Countries without active relay coverage: {countriesWithoutCoverage.map(c => `${flagEmoji(c)} ${c}`).join(', ')}
            </div>
          )}
        </div>
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

      {canManage && businessId && (
        <div style={box} className="space-y-2">
          <div>
            <div className="font-medium">{L.relay.sendTitle}</div>
            <div className="text-xs" style={{ color: 'var(--c-text-muted)' }}>{L.relay.sendHint}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <input value={sendPhone} onChange={(e) => setSendPhone(e.target.value)} placeholder={L.relay.sendPhonePlaceholder}
              className="px-3 py-2 rounded-md text-sm" style={{ border: `1px solid ${BORDER}`, background: 'transparent', color: 'inherit', minWidth: 200 }} />
            <input value={sendBody} onChange={(e) => setSendBody(e.target.value)} placeholder={L.relay.sendBodyPlaceholder} maxLength={300}
              className="px-3 py-2 rounded-md text-sm flex-1" style={{ border: `1px solid ${BORDER}`, background: 'transparent', color: 'inherit', minWidth: 240 }} />
            <button onClick={sendTest} disabled={pending || !sendPhone.trim() || !sendBody.trim()}
              className="px-3 py-2 rounded-md text-sm font-medium" style={{ background: 'var(--c-accent, #1D6E92)', color: '#fff', opacity: pending ? 0.6 : 1 }}>
              {L.relay.sendBtn}
            </button>
          </div>
          {sendMsg && <div className="text-sm" style={{ color: '#166534' }}>{sendMsg}</div>}
          {sendErr && <div className="text-sm" style={{ color: '#991B1B' }}>{sendErr}</div>}
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

      {/* Filters */}
      {devices.length > 0 && (
        <div style={box} className="flex flex-wrap items-center gap-2 text-sm">
          <span style={{ color: 'var(--c-text-muted)' }}>Filter:</span>
          <select value={fStatus} onChange={e => setFStatus(e.target.value as typeof fStatus)}
            className="px-2 py-1 rounded-md" style={{ border: `1px solid ${BORDER}`, background: 'transparent', color: 'inherit' }}>
            <option value="all">All statuses</option>
            <option value="online">Active (online)</option>
            <option value="offline">Offline / paused</option>
            <option value="revoked">Revoked</option>
          </select>
          <select value={fCountry} onChange={e => setFCountry(e.target.value)}
            className="px-2 py-1 rounded-md" style={{ border: `1px solid ${BORDER}`, background: 'transparent', color: 'inherit' }}>
            <option value="">Any country</option>
            {allCountries.map(c => <option key={c} value={c}>{flagEmoji(c)} {c}</option>)}
          </select>
          <label className="inline-flex items-center gap-1">
            <input type="checkbox" checked={fNoCountries} onChange={e => setFNoCountries(e.target.checked)} />
            No countries assigned
          </label>
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={box} className="text-sm">{devices.length === 0 ? L.relay.noDevices : 'No relays match the filters.'}</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(d => {
            const s = liveStatus(d, now);
            const noCountries = !d.countryRoutingEnabled || d.allowedCountryCodes.length === 0;
            const editing = editingId === d.deviceId;
            return (
              <div key={d.deviceId} style={box} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{d.label}</div>
                  <span className="text-xs px-2 py-1 rounded-full" style={{ background: '#0000000d', color: s.color }}>● {s.text}</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-sm" style={{ color: 'var(--c-text-muted)' }}>
                  <div>{L.relay.lastSeen}: {relativeTime(d.lastHeartbeatAt, now)}</div>
                  <div>{L.relay.app}: {d.appVersion ?? '—'}</div>
                  <div>{L.relay.device}: {[d.manufacturer, d.model].filter(Boolean).join(' ') || '—'}</div>
                  <div>{L.relay.sim}: {d.simInfo.map(s => s.carrierName).filter(Boolean).join(', ') || '—'}</div>
                  <div>{L.relay.today}: {d.sentToday} / {d.failedToday} / {d.deliveredToday}</div>
                  {d.lastError && <div className="text-red-600">{L.relay.lastError}: {d.lastError}</div>}
                </div>

                {/* Countries */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-sm" style={{ color: 'var(--c-text-muted)' }}>Countries:</span>
                  {editing ? (
                    <>
                      <CountryPicker value={editCodes} onChange={setEditCodes} />
                      <button onClick={() => saveCountries(d)} disabled={pending}
                        className="px-3 py-1.5 rounded-md text-sm font-medium" style={{ background: 'var(--c-accent, #1D6E92)', color: '#fff' }}>Save</button>
                      <button onClick={() => setEditingId(null)} disabled={pending}
                        className="px-3 py-1.5 rounded-md text-sm" style={{ border: `1px solid ${BORDER}` }}>Cancel</button>
                    </>
                  ) : (
                    <>
                      {noCountries ? (
                        <span className="text-xs px-2 py-1 rounded-full" style={{ background: '#FEF3C7', color: '#92400E' }}>
                          ⚠ No countries — not used for sending
                        </span>
                      ) : (
                        d.allowedCountryCodes.map(c => (
                          <span key={c} className="text-xs px-2 py-1 rounded-full" style={{ background: '#0000000d' }}>{flagEmoji(c)} {c}</span>
                        ))
                      )}
                      {canManage && d.status !== 'revoked' && (
                        <button onClick={() => startEdit(d)} disabled={pending}
                          className="px-2 py-1 rounded-md text-xs" style={{ border: `1px solid ${BORDER}` }}>Edit countries</button>
                      )}
                    </>
                  )}
                </div>

                {/* Send caps */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm" style={{ color: 'var(--c-text-muted)' }}>{L.relay.caps}:</span>
                  {capsId === d.deviceId ? (
                    <>
                      {(Object.keys(RELAY_CAP_BOUNDS) as (keyof RelayCaps)[]).map(k => (
                        <label key={k} className="text-xs inline-flex items-center gap-1">
                          {k === 'maxPerMinute' ? L.relay.capsMinute : k === 'maxPerHour' ? L.relay.capsHour : L.relay.capsDay}
                          <input type="number" min={RELAY_CAP_BOUNDS[k][0]} max={RELAY_CAP_BOUNDS[k][1]} step={1}
                            value={capsDraft[k]} onChange={e => setCapsDraft({ ...capsDraft, [k]: e.target.value })}
                            className="px-2 py-1 rounded-md text-sm w-20" style={{ border: `1px solid ${BORDER}`, background: 'transparent', color: 'inherit' }} />
                        </label>
                      ))}
                      <button onClick={() => saveCaps(d)} disabled={pending}
                        className="px-3 py-1.5 rounded-md text-sm font-medium" style={{ background: 'var(--c-accent, #1D6E92)', color: '#fff' }}>Save</button>
                      <button onClick={() => setCapsId(null)} disabled={pending}
                        className="px-3 py-1.5 rounded-md text-sm" style={{ border: `1px solid ${BORDER}` }}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <span className="text-sm">{d.caps.maxPerMinute} / {d.caps.maxPerHour} / {d.caps.maxPerDay}</span>
                      {canManage && isPlatform && d.status !== 'revoked' && (
                        <button onClick={() => startCaps(d)} disabled={pending}
                          className="px-2 py-1 rounded-md text-xs" style={{ border: `1px solid ${BORDER}` }}>{L.relay.capsEdit}</button>
                      )}
                    </>
                  )}
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
