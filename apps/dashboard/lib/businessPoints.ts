import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { orgSenderUid } from './orgMessagingService';

export type BusinessPointsPackage = { id: string; name: string; points: number };
export type BusinessPointsRequest = {
  id: string;
  packageName: string;
  points: number;
  status: 'pending' | 'approved' | 'rejected';
  note: string | null;
  reviewNote: string | null;
  createdAt: string;
};

type PackageData = { status?: string; name?: string; points?: number };

function activePackage(id: string, data?: PackageData): BusinessPointsPackage | null {
  const points = data?.points;
  if (data?.status !== 'active' || typeof points !== 'number' || !Number.isSafeInteger(points) || points <= 0) return null;
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  return { id, name: name || 'OfflineSMS points', points };
}

export async function getBusinessPointsData(organizationId: string) {
  const walletId = orgSenderUid(organizationId);
  const [wallet, packages, requests] = await Promise.all([
    adminDb.collection('wallets').doc(walletId).get(),
    adminDb.collection('pointsPackages').where('status', '==', 'active').get(),
    adminDb.collection('pointsRequests').where('userId', '==', walletId)
      .select('organizationId', 'status', 'packageName', 'points', 'note', 'reviewNote', 'createdAt').get(),
  ]);
  const activePackages = packages.docs
    .map(doc => ({ item: activePackage(doc.id, doc.data()), order: Number(doc.get('sortOrder') ?? 0) }))
    .sort((a, b) => a.order - b.order)
    .flatMap(({ item }) => item ? [item] : []);
  const history = requests.docs.flatMap((doc): BusinessPointsRequest[] => {
    const data = doc.data();
    const status = data.status;
    if (data.organizationId !== organizationId || (status !== 'pending' && status !== 'approved' && status !== 'rejected')) {
      return [];
    }
    return [{
      id: doc.id,
      packageName: data.packageName,
      points: data.points,
      status,
      note: data.note ?? null,
      reviewNote: data.reviewNote ?? null,
      createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : '',
    }];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const balance: number = wallet.get('balance') ?? 0;
  const reserved: number = wallet.get('reserved') ?? 0;
  return {
    balance,
    reserved,
    available: Math.max(0, balance),
    packages: activePackages,
    // Keep the pending request visible even if an organization has a long history.
    requests: [...history.filter(row => row.status === 'pending'), ...history.filter(row => row.status !== 'pending')].slice(0, 50),
  };
}

export async function createBusinessPointsRequest(
  organizationId: string,
  requestedByUid: string,
  packageId: string,
  note: string | null,
) {
  const userId = orgSenderUid(organizationId);
  const organizationRef = adminDb.collection('organizations').doc(organizationId);
  const packageRef = adminDb.collection('pointsPackages').doc(packageId);
  const requests = adminDb.collection('pointsRequests');
  const requestRef = requests.doc();
  const auditRef = adminDb.collection('auditLogs').doc();

  return adminDb.runTransaction(async tx => {
    const [organization, pkg] = await tx.getAll(organizationRef, packageRef);
    if (!organization.exists || organization.get('status') !== 'active') return { error: 'This organization is not active.' };
    const item = activePackage(packageId, pkg.data());
    if (!item) return { error: 'Select an available points package.' };
    // Updating the same organization document serializes simultaneous
    // submissions, including the first request for a new organization.
    const lastRequestId: unknown = organization.get('lastPointsRequestId');
    if (typeof lastRequestId === 'string' && lastRequestId && !lastRequestId.includes('/')) {
      const last = await tx.get(requests.doc(lastRequestId));
      if (last.get('userId') === userId && last.get('status') === 'pending') {
        return { error: 'Your organization already has a pending points request.' };
      }
    }

    const now = FieldValue.serverTimestamp();
    tx.create(requestRef, {
      userId,
      organizationId,
      organizationName: organization.get('name') ?? organizationId,
      requestedByUid,
      packageId,
      packageName: item.name,
      points: item.points,
      note,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      reviewedAt: null,
      reviewedByUid: null,
      reviewNote: null,
    });
    tx.update(organizationRef, { lastPointsRequestId: requestRef.id });
    tx.create(auditRef, {
      action: 'points.request.created',
      actorUid: requestedByUid,
      targetType: 'pointsRequest',
      targetId: requestRef.id,
      result: 'success',
      metadata: { organizationId, packageId, points: item.points },
      createdAt: now,
    });
    return { success: true as const };
  });
}
