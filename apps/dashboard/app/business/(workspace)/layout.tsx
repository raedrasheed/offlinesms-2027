import { redirect } from 'next/navigation';
import { adminDb } from '@/lib/firebase-admin';
import { BusinessShell } from '../BusinessShell';
import { getBusinessWorkspaceSession } from './workspaceSession';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { organizationId, email } = await getBusinessWorkspaceSession();
  const organization = await adminDb.collection('organizations').doc(organizationId).get();
  if (!organization.exists) redirect('/login');
  const name: unknown = organization.get('name');

  return (
    <BusinessShell organizationName={typeof name === 'string' && name.trim() ? name : 'Your organization'} email={email}>
      {children}
    </BusinessShell>
  );
}
