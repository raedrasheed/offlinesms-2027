'use client';
import { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { ADMIN_ROLE_OPTIONS } from './roleOptions';

type OrgOption = { id: string; name: string; slug: string };
type Props = {
  targetUid: string;
  currentRole: string | null;
  currentOrgId: string | null;
  organizations: OrgOption[];
};

const ORG_ADMIN = 'organization_admin';

export default function RoleAssignAction({ targetUid, currentRole, currentOrgId, organizations }: Props) {
  const [selected, setSelected] = useState(currentRole ?? '');
  const [selectedOrg, setSelectedOrg] = useState(currentOrgId ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const isOrgAdmin = selected === ORG_ADMIN;
  const roleChanged = selected !== (currentRole ?? '');
  const orgChanged = isOrgAdmin && selectedOrg !== (currentOrgId ?? '');
  const needsOrg = isOrgAdmin && !selectedOrg;
  const canSubmit = !busy && (roleChanged || orgChanged) && !needsOrg;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isOrgAdmin && !selectedOrg) { setErr('Pick an organization for the Org Admin role.'); return; }

    const orgName = organizations.find(o => o.id === selectedOrg)?.name;
    const summary = isOrgAdmin
      ? `Assign "Org Admin" scoped to "${orgName ?? selectedOrg}"`
      : `Assign role "${selected || 'none'}"`;
    if (!confirm(`${summary} to this user? This action is logged.`)) return;

    setBusy(true); setErr(null); setSuccess(false);
    try {
      const fns = getFunctions(app, 'us-central1');
      if (isOrgAdmin) {
        // Sets both `role` and `organizationId` claims.
        await httpsCallable(fns, 'adminSetOrgRole')({
          uid: targetUid, role: ORG_ADMIN, organizationId: selectedOrg,
        });
      } else if (currentRole === ORG_ADMIN) {
        // Switching away from org admin: clear the org scope alongside the role.
        await httpsCallable(fns, 'adminSetOrgRole')({
          uid: targetUid, role: selected || null, organizationId: null,
        });
      } else {
        // Plain (cross-org) role change; keeps the last-super-admin guard.
        await httpsCallable(fns, 'adminSetRole')({ uid: targetUid, role: selected || null });
      }
      setSuccess(true);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'Role assignment failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={selected}
          onChange={e => setSelected(e.target.value)}
          className="border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white"
          disabled={busy}
        >
          <option value="">— No role —</option>
          {ADMIN_ROLE_OPTIONS.map(r => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>

        {isOrgAdmin && (
          <select
            value={selectedOrg}
            onChange={e => setSelectedOrg(e.target.value)}
            className="border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white"
            disabled={busy}
            aria-label="Organization"
          >
            <option value="">— Select organization —</option>
            {organizations.map(o => (
              <option key={o.id} value={o.id}>{o.name} ({o.slug})</option>
            ))}
          </select>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary-dark transition disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Assign role'}
        </button>
      </div>

      {isOrgAdmin && organizations.length === 0 && (
        <p className="text-xs text-amber-600">No organizations exist yet. Create one under Admin → Organizations first.</p>
      )}
      {err && <p className="text-xs text-red-600">{err}</p>}
      {success && <p className="text-xs text-emerald-600">Role updated.</p>}
    </form>
  );
}
