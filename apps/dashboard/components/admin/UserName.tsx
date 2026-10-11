// A person's label in admin tables: the resolved name as the primary text,
// with the uid kept visible as small secondary text (and in the tooltip) for
// auditing. Server-component safe (no client hooks).

import Link from 'next/link';
import { isExternalId, userLabel, type UserNameInfo } from '@/lib/userLabel';

type Props = {
  uid: string | null | undefined;
  info?: Partial<UserNameInfo> | null;
  /** Stored name snapshot used only when the profile has no name. */
  snapshot?: string | null;
  /** Link target; defaults to the admin user page. Pass null for no link. */
  href?: string | null;
  /** Show the uid line under the name (default true). */
  showUid?: boolean;
  /** Primary text colour (defaults to the theme text colour). */
  color?: string;
  className?: string;
};

export default function UserName({ uid, info, snapshot, href, showUid = true, color, className }: Props) {
  if (!uid) return <span style={{ color: 'var(--c-text-4)' }}>—</span>;
  const label = userLabel(info, { uid, snapshot });
  // Phone-only contacts have no user page.
  const target = href === undefined ? (isExternalId(uid) ? null : `/admin/users/${uid}`) : href;
  const name = (
    <span className="font-semibold text-xs truncate" style={{ color: color ?? 'var(--c-text)' }}>{label}</span>
  );
  return (
    <span className={`inline-flex flex-col min-w-0 max-w-full ${className ?? ''}`} title={uid}>
      {target ? <Link href={target as any} className="hover:underline truncate">{name}</Link> : name}
      {showUid && (
        <span className="font-mono text-[10px] truncate" style={{ color: 'var(--c-text-4)' }}>{uid}</span>
      )}
    </span>
  );
}
