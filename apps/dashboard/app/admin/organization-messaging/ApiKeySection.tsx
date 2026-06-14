'use client';

// API key management UI. The raw key arrives ONLY in the generate action's
// response and is held in component state — it is never persisted anywhere
// client- or server-side, so a refresh (or navigating away) loses it forever.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { OrgApiKeyActionState } from '@/lib/orgMessagingActions';
import type { OrgApiKeyStatus } from '@/lib/orgMessagingData';

type KeyAction = (prev: OrgApiKeyActionState, data: FormData) => Promise<OrgApiKeyActionState>;

const BORDER = 'var(--c-border)';

function fmt(iso: string): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '—';
}

export default function ApiKeySection({
  status, generateAction, revokeAction,
}: {
  status: OrgApiKeyStatus | null;
  generateAction: KeyAction;
  revokeAction: KeyAction;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function run(action: KeyAction, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setError(null);
    start(async () => {
      const res = await action(null, new FormData());
      if (res && 'error' in res) { setError(res.error); return; }
      if (res && 'success' in res && res.rawKey) { setRawKey(res.rawKey); setCopied(false); }
      router.refresh();   // re-render the server-rendered status fields
    });
  }

  async function copy() {
    if (!rawKey) return;
    try { await navigator.clipboard.writeText(rawKey); setCopied(true); } catch { /* noop */ }
  }

  const hasActive = status?.status === 'active';

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--c-error-bg)', border: '1px solid var(--c-error-border)', color: '#EF4444' }}>
          {error}
        </div>
      )}

      {/* One-time raw key reveal */}
      {rawKey && (
        <div className="rounded-lg px-4 py-3 space-y-2" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.4)' }}>
          <p className="text-sm font-bold" style={{ color: '#F59E0B' }}>
            Copy this key now. It will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md px-3 py-2 text-[12px] font-mono break-all" style={{ background: 'var(--c-bg)', border: `1px solid ${BORDER}`, color: 'var(--c-text)' }}>
              {rawKey}
            </code>
            <button
              type="button"
              onClick={copy}
              className="px-3 py-2 text-xs font-bold rounded-lg transition hover:brightness-110"
              style={{ background: '#1F7BA8', color: '#fff' }}
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {status ? (
        <div className="grid grid-cols-4 gap-4 text-sm">
          <KeyStat label="Status" value={status.status} highlight={hasActive} />
          <KeyStat label="Created" value={fmt(status.createdAt)} />
          <KeyStat label="Last used" value={fmt(status.lastUsedAt)} />
          <KeyStat label="Revoked" value={fmt(status.revokedAt)} />
        </div>
      ) : (
        <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
          No API key yet. Generate one to call the messaging API; the secret is shown exactly once.
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(
            generateAction,
            hasActive
              ? 'Generate a new API key? The current active key is revoked immediately and stops working.'
              : 'Generate an API key for this organization?',
          )}
          className="px-4 py-2 text-sm font-bold rounded-lg transition hover:brightness-110 disabled:opacity-50"
          style={{ background: '#1F7BA8', color: '#fff' }}
        >
          {pending ? 'Working…' : hasActive ? 'Regenerate API key' : 'Generate API key'}
        </button>
        {hasActive && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(revokeAction, 'Revoke the active API key? Programmatic sending stops immediately.')}
            className="px-4 py-2 text-sm font-bold rounded-lg transition disabled:opacity-50"
            style={{ border: '1px solid rgba(239,68,68,0.5)', color: '#EF4444' }}
          >
            Revoke API key
          </button>
        )}
      </div>
    </div>
  );
}

function KeyStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--c-text-4)' }}>{label}</p>
      <p className="text-sm font-extrabold mt-0.5 capitalize" style={highlight ? { color: '#22C55E' } : undefined}>{value}</p>
    </div>
  );
}
