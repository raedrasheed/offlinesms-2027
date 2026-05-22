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

export async function listUsers(cursor?: string): Promise<AdminUserRow[]> {
  let q = adminDb.collection('users').orderBy('createdAt', 'desc').limit(50);
  if (cursor) {
    const snap = await adminDb.collection('users').doc(cursor).get();
    if (snap.exists) q = q.startAfter(snap);
  }
  const result = await q.get();
  return result.docs.map(d => {
    const data = d.data();
    return {
      uid:              d.id,
      displayName:      (data.displayName as string | null) ?? null,
      username:         (data.username as string | null) ?? null,
      email:            (data.email as string | null) ?? null,
      phoneNumber:      (data.phoneNumber as string | null) ?? null,
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
  return {
    uid: snap.id,
    displayName:      (data.displayName as string | null) ?? null,
    username:         (data.username as string | null) ?? null,
    email:            (data.email as string | null) ?? null,
    phoneNumber:      (data.phoneNumber as string | null) ?? null,
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
  return snap.docs.map(d => {
    const data = d.data();
    return {
      uid:         d.id,
      displayName: null,
      username:    null,
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

export async function listGroups(cursor?: string): Promise<AdminGroupRow[]> {
  let q = adminDb
    .collection('conversations')
    .where('type', '==', 'group')
    .orderBy('createdAt', 'desc')
    .limit(50);
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
  return snap.docs.map(d => {
    const data = d.data();
    return {
      uid:         d.id,
      displayName: (data.displayName as string | null) ?? null,
      username:    (data.username as string | null) ?? null,
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
