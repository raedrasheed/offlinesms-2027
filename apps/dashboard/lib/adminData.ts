// Server-side admin data helpers.
//
// All functions use the Admin SDK (bypasses Firestore rules). Security is
// enforced by the caller (server component or server action) which must
// have already verified the session and checked the required capability
// before calling these helpers.
//
// Rules:
// - Always limit reads (default 50).
// - Never return raw phone/email — callers apply redaction.
// - Return plain serializable objects (no Firestore Timestamp/DocumentRef).

import { adminDb } from './firebase-admin';
import { safeDate } from './redaction';
import { resolveUserNames } from './userNames';
import { looksLikeUid } from './userLabel';

export type AdminUserRow = {
  uid: string;
  displayName: string | null;
  username: string | null;
  email: string | null;         // raw — caller masks
  phoneNumber: string | null;   // raw — caller masks
  status: string;
  profileCompleted: boolean;
  smsOptOut: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminOrgRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  ownerUid: string;
  smsEnabled: boolean;
  pointsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminGroupRow = {
  id: string;
  name: string | null;
  ownerUid: string | null;
  status: string;
  memberCount: number;
  organizationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminMemberRow = {
  uid: string;
  displayName: string | null;
  username: string | null;
  role: string;
  status: string;
  joinedAt: string;
};

export type AdminAuditRow = {
  id: string;
  action: string;
  actorEmail: string | null;
  actorUid: string;
  result: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
};

// ─── Users ───────────────────────────────────────────────────────────────────

export async function listUsers(cursor?: string, status?: string): Promise<AdminUserRow[]> {
  let q = adminDb.collection('users').orderBy('createdAt', 'desc').limit(50) as FirebaseFirestore.Query;
  if (status) q = q.where('status', '==', status);
  if (cursor) {
    const snap = await adminDb.collection('users').doc(cursor).get();
    if (snap.exists) q = q.startAfter(snap);
  }
  const result = await q.get();
  // F1 Phase C: phone/email live in users/{uid}/userPrivate/profile, not the
  // public user doc. Fetch each row's private subdoc for display.
  const privSnaps = await Promise.all(
    result.docs.map(d => d.ref.collection('userPrivate').doc('profile').get()),
  );
  return result.docs.map((d, i) => {
    const data = d.data();
    const priv = privSnaps[i].data() ?? {};
    return {
      uid:              d.id,
      displayName:      (data.displayName as string | null) ?? null,
      username:         (data.username as string | null) ?? null,
      email:            (priv.email as string | null) ?? null,
      phoneNumber:      (priv.phoneNumber as string | null) ?? null,
      status:           (data.status as string | null) ?? 'active',
      profileCompleted: data.profileCompleted === true,
      smsOptOut:        data.smsOptOut === true,
      createdAt:        safeDate(data.createdAt),
      updatedAt:        safeDate(data.updatedAt),
    };
  });
}

export async function getUser(uid: string): Promise<AdminUserRow | null> {
  const snap = await adminDb.collection('users').doc(uid).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  // F1 Phase C: phone/email are read from users/{uid}/userPrivate/profile.
  const priv = (await snap.ref.collection('userPrivate').doc('profile').get()).data() ?? {};
  return {
    uid: snap.id,
    displayName:      (data.displayName as string | null) ?? null,
    username:         (data.username as string | null) ?? null,
    email:            (priv.email as string | null) ?? null,
    phoneNumber:      (priv.phoneNumber as string | null) ?? null,
    status:           (data.status as string | null) ?? 'active',
    profileCompleted: data.profileCompleted === true,
    smsOptOut:        data.smsOptOut === true,
    createdAt:        safeDate(data.createdAt),
    updatedAt:        safeDate(data.updatedAt),
  };
}

export async function getUserWalletBalance(uid: string): Promise<{ balance: number; reserved: number } | null> {
  const snap = await adminDb.collection('wallets').doc(uid).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  return {
    balance:  (data.balance  as number) ?? 0,
    reserved: (data.reserved as number) ?? 0,
  };
}

export async function getUserGroupMemberships(uid: string, limit = 10): Promise<{ id: string; name: string | null; role: string }[]> {
  // Find conversations where this uid is a member by querying the members subcollection
  // is expensive; instead query conversations where participantUids array contains uid
  const snap = await adminDb
    .collection('conversations')
    .where('type', '==', 'group')
    .where('participantUids', 'array-contains', uid)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  return snap.docs.map(d => {
    const data = d.data();
    return {
      id:   d.id,
      name: (data.name as string | null) ?? null,
      role: data.ownerUid === uid ? 'owner' : 'member',
    };
  });
}

export async function getUserRecentAudit(uid: string, limitCount = 5): Promise<AdminAuditRow[]> {
  const snap = await adminDb
    .collection('auditLogs')
    .where('actorUid', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(limitCount)
    .get();
  return snap.docs.map(d => {
    const data = d.data();
    return {
      id:         d.id,
      action:     (data.action as string) ?? '—',
      actorEmail: (data.actorEmail as string | null) ?? null,
      actorUid:   (data.actorUid as string) ?? uid,
      result:     (data.result as string) ?? 'success',
      targetType: (data.targetType as string | null) ?? null,
      targetId:   (data.targetId as string | null) ?? null,
      createdAt:  safeDate(data.createdAt),
    };
  });
}

// ─── Organizations ────────────────────────────────────────────────────────────

export async function listOrganizations(cursor?: string): Promise<AdminOrgRow[]> {
  let q = adminDb.collection('organizations').orderBy('createdAt', 'desc').limit(50);
  if (cursor) {
    const snap = await adminDb.collection('organizations').doc(cursor).get();
    if (snap.exists) q = q.startAfter(snap);
  }
  const result = await q.get();
  return result.docs.map(d => {
    const data = d.data();
    const settings = (data.settings as Record<string, any>) ?? {};
    return {
      id:           d.id,
      name:         (data.name as string) ?? '—',
      slug:         (data.slug as string) ?? '—',
      status:       (data.status as string) ?? 'active',
      ownerUid:     (data.ownerUid as string) ?? '—',
      smsEnabled:   settings.smsEscalationEnabled === true,
      pointsEnabled: settings.pointsEnabled === true,
      createdAt:    safeDate(data.createdAt),
      updatedAt:    safeDate(data.updatedAt),
    };
  });
}

export async function getOrganization(id: string): Promise<(AdminOrgRow & { settings: Record<string, unknown> }) | null> {
  const snap = await adminDb.collection('organizations').doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  const settings = (data.settings as Record<string, any>) ?? {};
  return {
    id: snap.id,
    name:         (data.name as string) ?? '—',
    slug:         (data.slug as string) ?? '—',
    status:       (data.status as string) ?? 'active',
    ownerUid:     (data.ownerUid as string) ?? '—',
    smsEnabled:   settings.smsEscalationEnabled === true,
    pointsEnabled: settings.pointsEnabled === true,
    createdAt:    safeDate(data.createdAt),
    updatedAt:    safeDate(data.updatedAt),
    settings: {
      smsEscalationEnabled: settings.smsEscalationEnabled ?? false,
      pointsEnabled:        settings.pointsEnabled ?? false,
      defaultLanguage:      settings.defaultLanguage ?? 'en',
      timezone:             settings.timezone ?? '—',
    },
  };
}

export async function listOrgMembers(orgId: string): Promise<(AdminMemberRow)[]> {
  const snap = await adminDb
    .collection('organizations').doc(orgId)
    .collection('members')
    .orderBy('joinedAt', 'desc')
    .limit(50)
    .get();
  // Org member docs carry no name: resolve from users/{uid} in one batch.
  const names = await resolveUserNames(snap.docs.map(d => d.id));
  return snap.docs.map(d => {
    const data = d.data();
    return {
      uid:         d.id,
      displayName: names[d.id]?.displayName ?? null,
      username:    names[d.id]?.username ?? null,
      role:        (data.role as string) ?? 'member',
      status:      'active',
      joinedAt:    safeDate(data.joinedAt),
    };
  });
}

export async function listOrgGroups(orgId: string): Promise<AdminGroupRow[]> {
  const snap = await adminDb
    .collection('conversations')
    .where('type', '==', 'group')
    .where('organizationId', '==', orgId)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return snap.docs.map(d => {
    const data = d.data();
    const pids = Array.isArray(data.participantUids) ? data.participantUids : [];
    return {
      id:             d.id,
      name:           (data.name as string | null) ?? null,
      ownerUid:       (data.ownerUid as string | null) ?? null,
      status:         (data.status as string | null) ?? 'active',
      memberCount:    pids.length,
      organizationId: orgId,
      createdAt:      safeDate(data.createdAt),
      updatedAt:      safeDate(data.updatedAt),
    };
  });
}

// ─── Groups ───────────────────────────────────────────────────────────────────

export async function listGroups(cursor?: string, status?: string): Promise<AdminGroupRow[]> {
  let q = adminDb
    .collection('conversations')
    .where('type', '==', 'group')
    .orderBy('createdAt', 'desc')
    .limit(50) as FirebaseFirestore.Query;
  if (status) q = q.where('status', '==', status);
  if (cursor) {
    const snap = await adminDb.collection('conversations').doc(cursor).get();
    if (snap.exists) q = q.startAfter(snap);
  }
  const result = await q.get();
  return result.docs.map(d => {
    const data = d.data();
    const pids = Array.isArray(data.participantUids) ? data.participantUids : [];
    return {
      id:             d.id,
      name:           (data.name as string | null) ?? null,
      ownerUid:       (data.ownerUid as string | null) ?? null,
      status:         (data.status as string | null) ?? 'active',
      memberCount:    pids.length,
      organizationId: (data.organizationId as string | null) ?? null,
      createdAt:      safeDate(data.createdAt),
      updatedAt:      safeDate(data.updatedAt),
    };
  });
}

export async function getGroup(id: string): Promise<(AdminGroupRow & { locked: boolean; description: string | null }) | null> {
  const snap = await adminDb.collection('conversations').doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  const pids = Array.isArray(data.participantUids) ? data.participantUids : [];
  return {
    id: snap.id,
    name:           (data.name as string | null) ?? null,
    ownerUid:       (data.ownerUid as string | null) ?? null,
    status:         (data.status as string | null) ?? 'active',
    locked:         data.status === 'locked',
    memberCount:    pids.length,
    organizationId: (data.organizationId as string | null) ?? null,
    description:    (data.description as string | null) ?? null,
    createdAt:      safeDate(data.createdAt),
    updatedAt:      safeDate(data.updatedAt),
  };
}

export async function listGroupMembers(conversationId: string): Promise<AdminMemberRow[]> {
  const snap = await adminDb
    .collection('conversations').doc(conversationId)
    .collection('members')
    .orderBy('joinedAt', 'asc')
    .limit(200)
    .get();
  // Member docs store `displayNameSnapshot` (not `displayName`) and no
  // username; prefer the live profile (batched getAll) and fall back to the
  // snapshot, ignoring legacy snapshots that are just the uid.
  const names = await resolveUserNames(snap.docs.map(d => d.id));
  return snap.docs.map(d => {
    const data = d.data();
    const snapshot = typeof data.displayNameSnapshot === 'string' && data.displayNameSnapshot.trim()
      && !looksLikeUid(data.displayNameSnapshot, d.id) ? data.displayNameSnapshot.trim() : null;
    return {
      uid:         d.id,
      displayName: names[d.id]?.displayName ?? snapshot,
      username:    names[d.id]?.username ?? null,
      role:        (data.role as string) ?? 'member',
      status:      (data.status as string) ?? 'active',
      joinedAt:    safeDate(data.joinedAt),
    };
  });
}

export async function getGroupSmsSummary(conversationId: string): Promise<{ total: number; lastBatchAt: string } | null> {
  const snap = await adminDb
    .collection('smsBatches')
    .where('conversationId', '==', conversationId)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  if (snap.empty) return null;
  const all = await adminDb
    .collection('smsBatches')
    .where('conversationId', '==', conversationId)
    .count()
    .get();
  return {
    total:       all.data().count,
    lastBatchAt: safeDate(snap.docs[0].data().createdAt),
  };
}

// ─── Communities ─────────────────────────────────────────────────────────────

export type AdminCommunityRow = {
  id: string;
  name: string | null;
  status: string;
  groupCount: number;
  memberCount: number;
  createdAt: string;
};

export async function listCommunities(): Promise<AdminCommunityRow[]> {
  const snap = await adminDb.collection('communities').orderBy('createdAt', 'desc').limit(50).get();
  return snap.docs.map(d => {
    const data = d.data();
    return {
      id:          d.id,
      name:        (data.name as string | null) ?? null,
      status:      (data.status as string | null) ?? 'active',
      groupCount:  (data.groupCount as number) ?? 0,
      memberCount: (data.memberCount as number) ?? 0,
      createdAt:   safeDate(data.createdAt),
    };
  });
}

export async function getCommunity(id: string): Promise<AdminCommunityRow | null> {
  const snap = await adminDb.collection('communities').doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  return {
    id:          snap.id,
    name:        (data.name as string | null) ?? null,
    status:      (data.status as string | null) ?? 'active',
    groupCount:  (data.groupCount as number) ?? 0,
    memberCount: (data.memberCount as number) ?? 0,
    createdAt:   safeDate(data.createdAt),
  };
}

// ─── SMS batches ──────────────────────────────────────────────────────────────

export type AdminSmsBatchRow = {
  id: string;
  conversationId: string | null;
  senderId: string | null;
  audience: string | null;
  status: string;
  totalCount: number;
  queuedCount: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  skippedCount: number;
  pointsCost: number;
  attemptNumber: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminSmsBatchRecipientRow = {
  uid: string;
  displayName: string | null;
  phone: string | null;   // raw — caller masks
  appReceiptStatus: string | null;
  smsStatus: string | null;
  skipReason: string | null;
  failureReason: string | null;
  updatedAt: string;
};

type SmsBatchFilters = {
  status?: string;
  cursor?: string;
};

export async function listSmsBatches(filters: SmsBatchFilters = {}): Promise<AdminSmsBatchRow[]> {
  let q = adminDb.collection('smsBatches').orderBy('createdAt', 'desc').limit(50);
  if (filters.status) q = q.where('status', '==', filters.status) as typeof q;
  if (filters.cursor) {
    const snap = await adminDb.collection('smsBatches').doc(filters.cursor).get();
    if (snap.exists) q = q.startAfter(snap);
  }
  const result = await q.get();
  return result.docs.map(d => {
    const data = d.data();
    return {
      id:             d.id,
      conversationId: (data.conversationId as string | null) ?? null,
      senderId:       (data.senderId as string | null) ?? null,
      audience:       (data.audience as string | null) ?? null,
      status:         (data.status as string) ?? 'unknown',
      totalCount:     (data.totalCount as number) ?? 0,
      queuedCount:    (data.queuedCount as number) ?? 0,
      sentCount:      (data.sentCount as number) ?? 0,
      deliveredCount: (data.deliveredCount as number) ?? 0,
      failedCount:    (data.failedCount as number) ?? 0,
      skippedCount:   (data.skippedCount as number) ?? 0,
      pointsCost:     (data.pointsCost as number) ?? 0,
      attemptNumber:  (data.attemptNumber as number) ?? 1,
      createdAt:      safeDate(data.createdAt),
      updatedAt:      safeDate(data.updatedAt),
    };
  });
}

export async function getSmsBatch(batchId: string): Promise<AdminSmsBatchRow | null> {
  const snap = await adminDb.collection('smsBatches').doc(batchId).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  return {
    id:             snap.id,
    conversationId: (data.conversationId as string | null) ?? null,
    senderId:       (data.senderId as string | null) ?? null,
    audience:       (data.audience as string | null) ?? null,
    status:         (data.status as string) ?? 'unknown',
    totalCount:     (data.totalCount as number) ?? 0,
    queuedCount:    (data.queuedCount as number) ?? 0,
    sentCount:      (data.sentCount as number) ?? 0,
    deliveredCount: (data.deliveredCount as number) ?? 0,
    failedCount:    (data.failedCount as number) ?? 0,
    skippedCount:   (data.skippedCount as number) ?? 0,
    pointsCost:     (data.pointsCost as number) ?? 0,
    attemptNumber:  (data.attemptNumber as number) ?? 1,
    createdAt:      safeDate(data.createdAt),
    updatedAt:      safeDate(data.updatedAt),
  };
}

export async function listSmsBatchRecipients(batchId: string, cursor?: string): Promise<AdminSmsBatchRecipientRow[]> {
  let q = adminDb
    .collection('smsBatches').doc(batchId)
    .collection('recipients')
    .orderBy('updatedAt', 'desc')
    .limit(100);
  if (cursor) {
    const snap = await adminDb.collection('smsBatches').doc(batchId)
      .collection('recipients').doc(cursor).get();
    if (snap.exists) q = q.startAfter(snap);
  }
  const result = await q.get();
  return result.docs.map(d => {
    const data = d.data();
    return {
      uid:              d.id,
      displayName:      (data.displayName as string | null) ?? null,
      phone:            (data.phone as string | null) ?? null,       // raw — caller masks
      appReceiptStatus: (data.appReceiptStatus as string | null) ?? null,
      smsStatus:        (data.smsStatus as string | null) ?? null,
      skipReason:       (data.skipReason as string | null) ?? null,
      failureReason:    (data.gatewayErrorMessage as string | null) ?? null,
      updatedAt:        safeDate(data.updatedAt),
    };
  });
}

// ─── Points / Wallets ─────────────────────────────────────────────────────────

export type AdminWalletRow = {
  uid: string;
  balance: number;
  reserved: number;
  available: number;
  status: string;
  updatedAt: string;
};

export type AdminTransactionRow = {
  id: string;
  uid: string;
  type: string;
  direction: string | null;
  amount: number;
  status: string;
  relatedBatchId: string | null;
  relatedPaymentId: string | null;
  createdAt: string;
};

export type AdminPaymentRow = {
  id: string;
  userId: string;
  packageId: string | null;
  totalPoints: number;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminPackageRow = {
  id: string;
  name: string;
  points: number;
  bonusPoints: number;
  price: number;
  currency: string;
  status: string;
  sortOrder: number;
};

export async function getWallet(uid: string): Promise<AdminWalletRow | null> {
  const snap = await adminDb.collection('wallets').doc(uid).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  const balance  = (data.balance  as number) ?? 0;
  const reserved = (data.reserved as number) ?? 0;
  return {
    uid:       snap.id,
    balance,
    reserved,
    available: Math.max(0, balance - reserved),
    status:    (data.status as string | null) ?? 'active',
    updatedAt: safeDate(data.updatedAt),
  };
}

export async function listWallets(cursor?: string, status?: string): Promise<AdminWalletRow[]> {
  let q = adminDb.collection('wallets').orderBy('updatedAt', 'desc').limit(50);
  if (status) q = q.where('status', '==', status) as typeof q;
  if (cursor) {
    const snap = await adminDb.collection('wallets').doc(cursor).get();
    if (snap.exists) q = q.startAfter(snap);
  }
  const result = await q.get();
  return result.docs.map(d => {
    const data = d.data();
    const balance  = (data.balance  as number) ?? 0;
    const reserved = (data.reserved as number) ?? 0;
    return {
      uid:       d.id,
      balance,
      reserved,
      available: Math.max(0, balance - reserved),
      status:    (data.status as string | null) ?? 'active',
      updatedAt: safeDate(data.updatedAt),
    };
  });
}

export async function listTransactions(cursor?: string, uid?: string, type?: string): Promise<AdminTransactionRow[]> {
  let q = adminDb.collection('transactions').orderBy('createdAt', 'desc').limit(50) as FirebaseFirestore.Query;
  if (uid)  q = q.where('uid',  '==', uid);
  if (type) q = q.where('type', '==', type);
  if (cursor) {
    const snap = await adminDb.collection('transactions').doc(cursor).get();
    if (snap.exists) q = q.startAfter(snap);
  }
  const result = await (q as any).get();
  return result.docs.map((d: any) => {
    const data = d.data();
    return {
      id:              d.id,
      uid:             (data.uid as string) ?? '—',
      type:            (data.type as string) ?? '—',
      direction:       (data.direction as string | null) ?? null,
      amount:          (data.amount as number) ?? 0,
      status:          (data.status as string) ?? 'completed',
      relatedBatchId:  (data.smsBatchId as string | null) ?? null,
      relatedPaymentId:(data.paymentId as string | null) ?? null,
      createdAt:       safeDate(data.createdAt),
    };
  });
}

export type AdminPointsRequestRow = {
  id: string;
  userId: string;
  packageId: string | null;
  packageName: string;
  points: number;
  note: string | null;
  status: string;        // pending | approved | rejected
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Points requests (user asks an admin to assign a package — no payment). */
export async function listPointsRequests(cursor?: string, status?: string): Promise<AdminPointsRequestRow[]> {
  let q = adminDb.collection('pointsRequests').orderBy('createdAt', 'desc').limit(50) as FirebaseFirestore.Query;
  if (status) q = q.where('status', '==', status);
  if (cursor) {
    const snap = await adminDb.collection('pointsRequests').doc(cursor).get();
    if (snap.exists) q = q.startAfter(snap);
  }
  const result = await q.get();
  return result.docs.map(d => {
    const data = d.data();
    return {
      id:          d.id,
      userId:      (data.userId as string) ?? '—',
      packageId:   (data.packageId as string | null) ?? null,
      packageName: (data.packageName as string) ?? '',
      points:      (data.points as number) ?? 0,
      note:        (data.note as string | null) ?? null,
      status:      (data.status as string) ?? '—',
      reviewNote:  (data.reviewNote as string | null) ?? null,
      createdAt:   safeDate(data.createdAt),
      updatedAt:   safeDate(data.updatedAt),
    };
  });
}

export async function listPayments(cursor?: string, status?: string): Promise<AdminPaymentRow[]> {
  let q = adminDb.collection('payments').orderBy('createdAt', 'desc').limit(50) as FirebaseFirestore.Query;
  if (status) q = q.where('status', '==', status);
  if (cursor) {
    const snap = await adminDb.collection('payments').doc(cursor).get();
    if (snap.exists) q = q.startAfter(snap);
  }
  const result = await q.get();
  return result.docs.map(d => {
    const data = d.data();
    return {
      id:          d.id,
      userId:      (data.userId as string) ?? '—',
      packageId:   (data.packageId as string | null) ?? null,
      totalPoints: (data.totalPoints as number) ?? 0,
      amount:      (data.amount as number) ?? 0,
      currency:    (data.currency as string) ?? '—',
      status:      (data.status as string) ?? '—',
      createdAt:   safeDate(data.createdAt),
      updatedAt:   safeDate(data.updatedAt),
    };
  });
}

export async function listPointsPackages(): Promise<AdminPackageRow[]> {
  const result = await adminDb.collection('pointsPackages').orderBy('sortOrder', 'asc').limit(50).get();
  return result.docs.map(d => {
    const data = d.data();
    return {
      id:          d.id,
      name:        (data.name as string) ?? '—',
      points:      (data.points as number) ?? 0,
      bonusPoints: (data.bonusPoints as number) ?? 0,
      price:       (data.price as number) ?? 0,
      currency:    (data.currency as string) ?? '—',
      status:      (data.status as string) ?? 'active',
      sortOrder:   (data.sortOrder as number) ?? 0,
    };
  });
}

// ─── Admin users (roles page) ─────────────────────────────────────────────────

export type AdminRoleUserRow = {
  uid: string;
  displayName: string | null;
  email: string | null;    // raw — shown on roles page (admin-only)
  role: string | null;
  isLegacyAdmin: boolean;
};

export async function listAdminUsers(): Promise<AdminRoleUserRow[]> {
  // Phase 15: Use Firebase Auth.listUsers() pagination to cover all users
  // regardless of whether they have a Firestore doc. We scan up to 3 pages
  // (3 000 users) which is adequate for admin dashboards; larger deployments
  // should use the export tool.
  const { getAuth } = await import('firebase-admin/auth');
  const auth = getAuth();
  const results: AdminRoleUserRow[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  const MAX_PAGES = 3;

  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      const claims = (u.customClaims ?? {}) as Record<string, unknown>;
      const role = typeof claims.role === 'string' ? claims.role : null;
      const isLegacyAdmin = claims.admin === true;
      if (!role && !isLegacyAdmin) continue;

      // Fetch display name from Firestore if available; fall back to Auth.displayName.
      let displayName: string | null = u.displayName ?? null;
      try {
        const snap = await adminDb.collection('users').doc(u.uid).get();
        if (snap.exists) {
          displayName = (snap.data()!.displayName as string | null) ?? displayName;
        }
      } catch { /* Firestore doc may not exist */ }

      results.push({
        uid:           u.uid,
        displayName,
        email:         u.email ?? null,
        role,
        isLegacyAdmin,
      });
    }
    pageToken = page.pageToken;
    pages++;
  } while (pageToken && pages < MAX_PAGES);

  return results.sort((a, b) => {
    const order = ['super_admin', 'organization_admin', 'support_agent', 'finance_admin', 'auditor'];
    return (order.indexOf(a.role ?? '') - order.indexOf(b.role ?? ''));
  });
}

// ─── Support tickets ──────────────────────────────────────────────────────────

export type AdminSupportTicketRow = {
  id: string;
  subject: string;
  category: string;
  status: string;
  createdBy: string;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminSupportTicketDetail = AdminSupportTicketRow & {
  description: string;
};

type SupportTicketFilters = {
  status?: string;
  category?: string;
  assignedTo?: string;
  cursor?: string;
};

export async function listSupportTickets(filters: SupportTicketFilters = {}): Promise<AdminSupportTicketRow[]> {
  let q = adminDb.collection('tickets').orderBy('createdAt', 'desc').limit(50);
  if (filters.status)     q = q.where('status',     '==', filters.status)     as typeof q;
  if (filters.category)   q = q.where('category',   '==', filters.category)   as typeof q;
  if (filters.assignedTo) q = q.where('assignedTo', '==', filters.assignedTo) as typeof q;
  if (filters.cursor) {
    const snap = await adminDb.collection('tickets').doc(filters.cursor).get();
    if (snap.exists) q = q.startAfter(snap);
  }
  const result = await q.get();
  return result.docs.map(d => {
    const data = d.data();
    return {
      id:         d.id,
      subject:    (data.subject    as string) ?? '—',
      category:   (data.category   as string) ?? 'other',
      status:     (data.status     as string) ?? 'open',
      createdBy:  (data.createdBy  as string) ?? '—',
      assignedTo: (data.assignedTo as string | null) ?? null,
      createdAt:  safeDate(data.createdAt),
      updatedAt:  safeDate(data.updatedAt),
    };
  });
}

export async function getSupportTicket(ticketId: string): Promise<AdminSupportTicketDetail | null> {
  const snap = await adminDb.collection('tickets').doc(ticketId).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  return {
    id:          snap.id,
    subject:     (data.subject     as string) ?? '—',
    category:    (data.category    as string) ?? 'other',
    status:      (data.status      as string) ?? 'open',
    createdBy:   (data.createdBy   as string) ?? '—',
    assignedTo:  (data.assignedTo  as string | null) ?? null,
    description: (data.description as string) ?? '',
    createdAt:   safeDate(data.createdAt),
    updatedAt:   safeDate(data.updatedAt),
  };
}

// ─── System settings ──────────────────────────────────────────────────────────

export type SystemSettings = {
  appName: string;
  supportEmail: string;
  defaultLanguage: string;
  defaultTimezone: string;
  smsEscalationEnabled: boolean;
  pointsEnabled: boolean;
  emailSignInEnabled: boolean;
  maintenanceMode: boolean;
};

const SETTINGS_DEFAULTS: SystemSettings = {
  appName:              'OfflineSMS',
  supportEmail:         '',
  defaultLanguage:      'en',
  defaultTimezone:      'UTC',
  smsEscalationEnabled: true,
  pointsEnabled:        true,
  emailSignInEnabled:   false,
  maintenanceMode:      false,
};

export async function getSystemSettings(): Promise<SystemSettings> {
  const snap = await adminDb.collection('systemSettings').doc('general').get();
  if (!snap.exists) return { ...SETTINGS_DEFAULTS };
  const d = snap.data()!;
  return {
    appName:              (d.appName              as string  | undefined) ?? SETTINGS_DEFAULTS.appName,
    supportEmail:         (d.supportEmail         as string  | undefined) ?? SETTINGS_DEFAULTS.supportEmail,
    defaultLanguage:      (d.defaultLanguage      as string  | undefined) ?? SETTINGS_DEFAULTS.defaultLanguage,
    defaultTimezone:      (d.defaultTimezone      as string  | undefined) ?? SETTINGS_DEFAULTS.defaultTimezone,
    smsEscalationEnabled: (d.smsEscalationEnabled as boolean | undefined) ?? SETTINGS_DEFAULTS.smsEscalationEnabled,
    pointsEnabled:        (d.pointsEnabled        as boolean | undefined) ?? SETTINGS_DEFAULTS.pointsEnabled,
    emailSignInEnabled:   (d.emailSignInEnabled   as boolean | undefined) ?? SETTINGS_DEFAULTS.emailSignInEnabled,
    maintenanceMode:      (d.maintenanceMode      as boolean | undefined) ?? SETTINGS_DEFAULTS.maintenanceMode,
  };
}

// ─── Dashboard counts ─────────────────────────────────────────────────────────

export type DashboardCounts = {
  totalUsers:       number | null;
  activeGroups:     number | null;
  smsBatchesToday:  number | null;
  failedSmsBatches: number | null;
  openTickets:      number | null;
  totalWallets:     number | null;
  pendingPayments:  number | null;
};

export async function getDashboardCounts(): Promise<DashboardCounts> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { Timestamp } = await import('firebase-admin/firestore');
  const todayTs = Timestamp.fromDate(todayStart);

  const safe = async (fn: () => Promise<number>): Promise<number | null> => {
    try { return await fn(); }
    catch { return null; }
  };

  const [totalUsers, activeGroups, smsBatchesToday, failedSmsBatches, openTickets, totalWallets, pendingPayments] =
    await Promise.all([
      safe(() => adminDb.collection('users').count().get().then(s => s.data().count)),
      safe(() => adminDb.collection('conversations').where('type', '==', 'group').where('status', '==', 'active').count().get().then(s => s.data().count)),
      safe(() => adminDb.collection('smsBatches').where('createdAt', '>=', todayTs).count().get().then(s => s.data().count)),
      safe(() => adminDb.collection('smsBatches').where('status', '==', 'failed').count().get().then(s => s.data().count)),
      safe(() => adminDb.collection('tickets').where('status', '==', 'open').count().get().then(s => s.data().count)),
      safe(() => adminDb.collection('wallets').count().get().then(s => s.data().count)),
      safe(() => adminDb.collection('payments').where('status', '==', 'pending').count().get().then(s => s.data().count)),
    ]);

  return { totalUsers, activeGroups, smsBatchesToday, failedSmsBatches, openTickets, totalWallets, pendingPayments };
}

// ─── Points package helpers ───────────────────────────────────────────────────

// ─── SMS delivery events ──────────────────────────────────────────────────────

export type AdminDeliveryEventRow = {
  id: string;
  status: string;
  result: string | null;
  receivedAt: string;
  processedAt: string | null;
  errorCode: string | null;
};

export async function listDeliveryEvents(
  batchId: string,
  cursor?: string,
): Promise<AdminDeliveryEventRow[]> {
  let q = adminDb.collection('smsDeliveryEvents')
    .where('offlineSmsBatchId', '==', batchId)
    .orderBy('receivedAt', 'desc')
    .limit(50) as FirebaseFirestore.Query;

  if (cursor) {
    const snap = await adminDb.collection('smsDeliveryEvents').doc(cursor).get();
    if (snap.exists) q = q.startAfter(snap);
  }

  const result = await q.get();
  return result.docs.map(d => {
    const data = d.data();
    return {
      id:          d.id,
      status:      (data.status      as string) ?? '—',
      result:      (data.result      as string | null) ?? null,
      receivedAt:  safeDate(data.receivedAt),
      processedAt: data.processedAt ? safeDate(data.processedAt) : null,
      errorCode:   (data.errorCode   as string | null) ?? null,
    };
  });
}

export async function getPointsPackage(packageId: string): Promise<AdminPackageRow | null> {
  const snap = await adminDb.collection('pointsPackages').doc(packageId).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  return {
    id:          snap.id,
    name:        (data.name        as string) ?? '—',
    points:      (data.points      as number) ?? 0,
    bonusPoints: (data.bonusPoints as number) ?? 0,
    price:       (data.price       as number) ?? 0,
    currency:    (data.currency    as string) ?? '—',
    status:      (data.status      as string) ?? 'active',
    sortOrder:   (data.sortOrder   as number) ?? 0,
  };
}
