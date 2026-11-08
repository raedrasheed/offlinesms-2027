import { adminDb } from './firebase-admin';
import { getAdminScope } from './adminScope';
import type { SessionResult } from './session';

export async function getAdminWorkspace(session: SessionResult & { state: 'authorized' }): Promise<string> {
  const { organizationId } = getAdminScope(session);
  if (!organizationId) return 'OfflineSMS platform';
  try {
    const doc = await adminDb.collection('organizations').doc(organizationId).get();
    const name = doc.get('name');
    return typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : 'Organization workspace';
  } catch { return 'Organization workspace'; }
}
