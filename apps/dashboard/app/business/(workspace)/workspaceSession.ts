import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { organizationClaim } from '@/lib/adminScope';
import { verifySession } from '@/lib/session';

export const getBusinessWorkspaceSession = cache(async () => {
  const session = await verifySession((await cookies()).get('__session')?.value);
  if (session.state !== 'authorized' || session.role !== 'organization_admin') redirect('/login');
  const organizationId = organizationClaim(session.user.claims);
  if (!organizationId || organizationId.includes('/')) redirect('/login');
  return { organizationId, email: session.user.email };
});

export async function getBusinessOrganizationId() {
  return (await getBusinessWorkspaceSession()).organizationId;
}
