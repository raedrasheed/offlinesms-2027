'use client';

// Compose form for an admin broadcast — title/body/imageUrl/action + audience
// picker. Calls the server actions for estimate + send. Confirmation step
// before the actual send, with a live preview.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  TITLE_MAX, BODY_MAX,
  type BroadcastInput, type BroadcastAudienceConfig, type BroadcastActionType,
} from '@/lib/broadcastLogic';

type EstimateFn = (a: BroadcastAudienceConfig) => Promise<{ estimatedUsers?: number; estimatedDevices?: number; error?: string }>;
type SendFn     = (i: BroadcastInput) => Promise<{ broadcastId?: string; sent?: number; failed?: number; invalidTokens?: number; success?: boolean; error?: string }>;

type Props = {
  isSuper:       boolean;
  organizations: { id: string; name: string }[];
  estimate:      EstimateFn;
  send:          SendFn;
};

type AudienceUI = 'all_users' | 'organization' | 'selected_users' | 'single_user' | 'role';

const ROLES: { value: string; label: string }[] = [
  { value: 'super_admin',          label: 'Super admins' },
  { value: 'organization_admin',   label: 'Organization admins' },
  { value: 'organization_member',  label: 'Organization members' },
  { value: 'support_agent',        label: 'Support agents' },
];

export default function BroadcastForm({ isSuper, organizations, estimate, send }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // Compose state.
  const [title, setTitle] = useState('');
  const [body,  setBody]  = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [actionType, setActionType] = useState<BroadcastActionType>('open_app');
  const [actionTarget, setActionTarget] = useState('');

  // Audience state.
  const [audienceType, setAudienceType] = useState<AudienceUI>(isSuper ? 'all_users' : 'organization');
  const [orgId, setOrgId] = useState<string>(organizations[0]?.id ?? '');
  const [role, setRole]   = useState<string>('organization_member');
  const [userIdsText, setUserIdsText] = useState<string>('');   // comma/space-separated uids

  const [estResult, setEstResult] = useState<{ users: number; devices: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function buildAudience(): BroadcastAudienceConfig {
    switch (audienceType) {
      case 'all_users':      return { type: 'all_users' };
      case 'organization':   return { type: 'organization', organizationIds: orgId ? [orgId] : [] };
      case 'role':           return { type: 'role', role };
      case 'selected_users':
      case 'single_user': {
        const ids = userIdsText.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
        return audienceType === 'single_user'
          ? { type: 'single_user', userIds: ids.slice(0, 1) }
          : { type: 'selected_users', userIds: ids };
      }
    }
  }

  function buildInput(): BroadcastInput {
    return {
      title, body,
      imageUrl: imageUrl || undefined,
      actionType,
      actionTarget: actionTarget || undefined,
      audience: buildAudience(),
    };
  }

  function onEstimate() {
    setMsg(null); setEstResult(null);
    start(async () => {
      const res = await estimate(buildAudience());
      if (res.error) setMsg({ kind: 'err', text: humanError(res.error) });
      else setEstResult({ users: res.estimatedUsers ?? 0, devices: res.estimatedDevices ?? 0 });
    });
  }

  function onAskConfirm() {
    setMsg(null);
    if (!estResult) { onEstimate(); return; }
    setConfirming(true);
  }

  function onSend() {
    setConfirming(false); setMsg(null);
    start(async () => {
      const res = await send(buildInput());
      if (res.error) setMsg({ kind: 'err', text: humanError(res.error) });
      else {
        setMsg({ kind: 'ok', text: `Sent to ${res.sent ?? 0} device${res.sent === 1 ? '' : 's'} (${res.failed ?? 0} failed, ${res.invalidTokens ?? 0} invalid).` });
        // reset compose, keep audience
        setTitle(''); setBody(''); setImageUrl(''); setActionTarget('');
        setEstResult(null);
        router.refresh();
      }
    });
  }

  const titleLeft = TITLE_MAX - title.length;
  const bodyLeft  = BODY_MAX  - body.length;
  const audienceLabel = audienceType.replace(/_/g, ' ');

  return (
    <div className="space-y-5">
      {/* Compose */}
      <div className="grid grid-cols-1 gap-4">
        <Field label="Title" hint={`${titleLeft} chars left`}>
          <input
            value={title} onChange={e => setTitle(e.target.value.slice(0, TITLE_MAX + 1))}
            placeholder="E.g. Scheduled maintenance"
            className={input}
          />
        </Field>
        <Field label="Body" hint={`${bodyLeft} chars left`}>
          <textarea
            value={body} onChange={e => setBody(e.target.value.slice(0, BODY_MAX + 1))}
            placeholder="What do you want users to know?"
            rows={3}
            className={input}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Image URL (optional, https only)">
            <input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://…" className={input} />
          </Field>
          <Field label="On tap">
            <select value={actionType} onChange={e => setActionType(e.target.value as BroadcastActionType)} className={input}>
              <option value="open_app">Open app</option>
              <option value="open_url">Open URL</option>
              <option value="open_chat">Open chat (advanced)</option>
              <option value="open_group">Open group (advanced)</option>
              <option value="none">No action</option>
            </select>
          </Field>
        </div>
        {(actionType === 'open_url' || actionType === 'open_chat' || actionType === 'open_group') && (
          <Field label={actionType === 'open_url' ? 'URL (https only)' : 'Target id'}>
            <input
              value={actionTarget} onChange={e => setActionTarget(e.target.value)}
              placeholder={actionType === 'open_url' ? 'https://…' : 'conversationId / groupId'}
              className={input}
            />
          </Field>
        )}
      </div>

      {/* Audience */}
      <div className="rounded-xl p-4" style={{ background: 'var(--c-bg)', border: '1px solid var(--c-border)' }}>
        <p className="text-xs font-bold mb-3" style={{ color: 'var(--c-text-3)' }}>Audience</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {isSuper && <Chip on={audienceType === 'all_users'}      onClick={() => setAudienceType('all_users')}>All users</Chip>}
          <Chip on={audienceType === 'organization'}   onClick={() => setAudienceType('organization')}>Organization</Chip>
          <Chip on={audienceType === 'selected_users'} onClick={() => setAudienceType('selected_users')}>Selected users</Chip>
          <Chip on={audienceType === 'single_user'}    onClick={() => setAudienceType('single_user')}>Single user</Chip>
          {isSuper && <Chip on={audienceType === 'role'} onClick={() => setAudienceType('role')}>Role</Chip>}
        </div>

        {audienceType === 'organization' && (
          <Field label="Organization">
            <select value={orgId} onChange={e => setOrgId(e.target.value)} className={input}>
              {organizations.map(o => <option key={o.id} value={o.id}>{o.name || o.id}</option>)}
            </select>
          </Field>
        )}
        {audienceType === 'role' && (
          <Field label="Role">
            <select value={role} onChange={e => setRole(e.target.value)} className={input}>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
        )}
        {(audienceType === 'selected_users' || audienceType === 'single_user') && (
          <Field label={audienceType === 'single_user' ? 'User UID' : 'User UIDs (comma or space separated)'} hint="Paste from the Users page; org admins can only target users in their org.">
            <textarea
              value={userIdsText} onChange={e => setUserIdsText(e.target.value)}
              placeholder={audienceType === 'single_user' ? 'uid' : 'uid1, uid2, uid3'}
              rows={2}
              className={input}
            />
          </Field>
        )}
      </div>

      {/* Preview */}
      <div className="rounded-xl p-4" style={{ background: 'var(--c-bg)', border: '1px solid var(--c-border)' }}>
        <p className="text-xs font-bold mb-2" style={{ color: 'var(--c-text-3)' }}>Preview</p>
        <div className="rounded-md p-3" style={{ background: '#fff', border: '1px solid var(--c-border)' }}>
          <p className="text-sm font-bold" style={{ color: '#000' }}>{title || 'Title'}</p>
          <p className="text-sm" style={{ color: '#333' }}>{body || 'Body'}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onEstimate} disabled={pending} className="px-4 py-2 text-sm font-bold rounded-lg" style={{ background: '#0A1828', color: '#5BB6DE', border: '1px solid #0E3A5A' }}>
          {pending && !confirming ? 'Estimating…' : 'Estimate audience'}
        </button>
        {estResult && (
          <span className="text-sm" style={{ color: 'var(--c-text-2)' }}>
            Approx. <b>{estResult.users}</b> user{estResult.users === 1 ? '' : 's'} · <b>{estResult.devices}</b> device{estResult.devices === 1 ? '' : 's'}
          </span>
        )}
        <button onClick={onAskConfirm} disabled={pending || !title || !body} className="px-5 py-2 text-sm font-bold rounded-lg transition hover:brightness-110 disabled:opacity-50" style={{ background: '#1F7BA8', color: '#fff' }}>
          Send
        </button>
        {msg && <span className="text-sm" style={{ color: msg.kind === 'ok' ? '#22C55E' : '#EF4444' }}>{msg.text}</span>}
      </div>

      {/* Confirmation */}
      {confirming && (
        <div className="rounded-xl p-4" style={{ background: '#FEF3C7', border: '1px solid #F59E0B' }}>
          <p className="text-sm font-bold mb-2" style={{ color: '#92400E' }}>
            You are about to send this notification to approximately {estResult?.users ?? '?'} user{estResult?.users === 1 ? '' : 's'} / {estResult?.devices ?? '?'} device{estResult?.devices === 1 ? '' : 's'} ({audienceLabel}).
          </p>
          <p className="text-xs mb-3" style={{ color: '#92400E' }}>This action is logged and cannot be undone.</p>
          <div className="flex gap-2">
            <button onClick={onSend} disabled={pending} className="px-4 py-2 text-sm font-bold rounded-lg" style={{ background: '#1F7BA8', color: '#fff' }}>
              {pending ? 'Sending…' : 'Confirm & send'}
            </button>
            <button onClick={() => setConfirming(false)} disabled={pending} className="px-4 py-2 text-sm rounded-lg" style={{ background: '#fff', color: '#92400E', border: '1px solid #F59E0B' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="block text-xs font-bold" style={{ color: 'var(--c-text-2)' }}>{label}</label>
        {hint && <span className="text-[10px]" style={{ color: 'var(--c-text-4)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick}
      className="px-3 py-1.5 text-xs font-bold rounded-full"
      style={{ background: on ? '#1F7BA8' : '#fff', color: on ? '#fff' : 'var(--c-text)', border: `1px solid ${on ? '#1F7BA8' : 'var(--c-border)'}` }}
    >
      {children}
    </button>
  );
}

const input = 'w-full px-3 py-2 text-sm rounded-md focus:outline-none';
// inline style for input is defined via Tailwind-ish class only; bg/border come from CSS vars.

function humanError(code: string): string {
  switch (code) {
    case 'title-required':            return 'Title is required.';
    case 'title-too-long':            return `Title is too long (max ${TITLE_MAX}).`;
    case 'body-required':             return 'Body is required.';
    case 'body-too-long':             return `Body is too long (max ${BODY_MAX}).`;
    case 'image-not-https':           return 'Image URL must be https.';
    case 'action-target-required':    return 'This action needs a target.';
    case 'action-target-not-https':   return 'URL targets must be https.';
    case 'audience-missing-org':      return 'Choose an organization.';
    case 'audience-missing-users':    return 'Enter at least one user UID.';
    case 'audience-missing-user':     return 'Enter exactly one user UID.';
    case 'audience-missing-role':     return 'Choose a role.';
    case 'audience-role-invalid':     return 'Role not allowed.';
    case 'org-admin-cannot-target-all':  return 'Only super admins can target all users.';
    case 'org-admin-cannot-target-role': return 'Only super admins can target by role.';
    case 'org-admin-org-mismatch':    return 'You can only target users in your organization.';
    case 'audience-too-large':        return 'Audience too large. Narrow the target.';
    case 'broadcast-rate-limit':      return 'Too many broadcasts recently. Try again later.';
    default:                          return code;
  }
}
