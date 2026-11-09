import { cookies } from 'next/headers';
import { verifySession } from './session';
import { isPlatformAdmin } from './adminScope';
import { canDo, type AdminCapability } from './adminPermissions';
import { hasPlatformClipClaims } from './clipAdminPolicy';

/** Every read and write entry point checks the verified session. Admin SDK
 * access is never inferred from an absent organization claim or UI visibility. */
async function requireContentAdmin(capability: AdminCapability) {
  const session = await verifySession((await cookies()).get('__session')?.value);
  if (session.state !== 'authorized' || !isPlatformAdmin(session) || !canDo(session.role, capability)
      || (session.role !== 'super_admin' && !hasPlatformClipClaims(session.user.claims))) {
    throw new Error('Platform administrator access is required.');
  }
  return { uid: session.user.uid, email: session.user.email ?? null };
}

export const requireClipsAdmin = () => requireContentAdmin('manage:clips');
export const requireStatusesAdmin = () => requireContentAdmin('manage:statuses');
