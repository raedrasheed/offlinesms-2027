// Repair existing group membership lists before enabling the two-document
// Storage ACL. Deploy the Firestore marker-create guard, then transaction-safe
// group membership functions FIRST; reconcile before deploying Storage rules.
// Dry run: npx tsx scripts/reconcileGroupMediaAccess.ts --project=<project-id>
// Apply:   npx tsx scripts/reconcileGroupMediaAccess.ts --project=<project-id> --apply
// Optional: --group=<conversation-id>. Uses Application Default Credentials.
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const MEMBER_READ_BATCH_SIZE = 100;
const GROUP_PAGE_SIZE = 100;
type DocumentData = Record<string, unknown>;
export interface MemberAccess {
  exists: boolean;
  status?: unknown;
}
export interface ReconciliationResult {
  groupId: string;
  outcome: 'applied' | 'would-update' | 'unchanged' | 'skipped';
  reason?: 'missing' | 'not-group' | 'invalid-canonical-membership';
  markerAction?: 'would-revoke' | 'revoked';
  source?: 'participantUids' | 'memberIds';
  beforeCount?: number;
  afterCount?: number;
  removedCount?: number;
}

function validId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && !id.includes('/')
    && id !== '.' && id !== '..' && Buffer.byteLength(id, 'utf8') <= 1500;
}

/** Never fall back to stale memberIds when participantUids is present. */
export function canonicalGroupParticipants(data: DocumentData): {
  source: 'participantUids' | 'memberIds'; participantUids: string[];
} {
  const source = Object.prototype.hasOwnProperty.call(data, 'participantUids')
    ? 'participantUids' : 'memberIds';
  const values = data[source];
  if (!Array.isArray(values) || !values.every(validId)) {
    throw new Error('Invalid canonical membership list.');
  }
  return { source, participantUids: [...new Set(values)] };
}

/** Every candidate must have been read, including missing member documents. */
export function planGroupMediaAccess(
  data: DocumentData,
  members: ReadonlyMap<string, MemberAccess>,
) {
  const canonical = canonicalGroupParticipants(data);
  const participantUids = canonical.participantUids.filter(uid => {
    const member = members.get(uid);
    if (!member) throw new Error('Not all candidate member documents were checked.');
    // This matches the rules default: an absent status is active; null is not.
    return member.exists && (member.status === undefined || member.status === 'active');
  });
  return {
    source: canonical.source,
    participantUids,
    beforeCount: canonical.participantUids.length,
    afterCount: participantUids.length,
    removedCount: canonical.participantUids.length - participantUids.length,
  };
}

function sameIds(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length
    && value.every((uid, index) => uid === expected[index]);
}

/**
 * All reads belong to the same transaction. If membership changes concurrently,
 * Firestore retries the ENTIRE callback, including canonical and member reads.
 * Chunking bounds each read RPC; there is only one document write per group.
 * A read/time/quota error aborts without certifying an incomplete member scan.
 */
export async function reconcileGroupMediaAccess(
  firestore: Firestore,
  groupId: string,
  options: { apply?: boolean } = {},
): Promise<ReconciliationResult> {
  if (!validId(groupId)) throw new Error('Invalid conversation id.');
  const conversationRef = firestore.collection('conversations').doc(groupId);
  return firestore.runTransaction<ReconciliationResult>(async transaction => {
    const snapshot = await transaction.get(conversationRef);
    if (!snapshot.exists) return { groupId, outcome: 'skipped', reason: 'missing' };
    const data = snapshot.data()!;
    if (data.type !== 'group') return { groupId, outcome: 'skipped', reason: 'not-group' };
    let canonical: ReturnType<typeof canonicalGroupParticipants>;
    try {
      canonical = canonicalGroupParticipants(data);
    } catch {
      // Old client-create rules may have allowed a forged marker. A malformed
      // list must not retain a marker that would unlock Storage after rollout.
      const marked = data.mediaAclVersion === 2;
      if (marked && options.apply === true) {
        transaction.update(conversationRef, { mediaAclVersion: FieldValue.delete() });
      }
      return {
        groupId, outcome: 'skipped', reason: 'invalid-canonical-membership',
        ...(marked ? { markerAction: options.apply === true ? 'revoked' : 'would-revoke' } : {}),
      };
    }
    const members = new Map<string, MemberAccess>();
    for (let offset = 0; offset < canonical.participantUids.length; offset += MEMBER_READ_BATCH_SIZE) {
      const refs = canonical.participantUids.slice(offset, offset + MEMBER_READ_BATCH_SIZE)
        .map(uid => conversationRef.collection('members').doc(uid));
      const snapshots = await transaction.getAll(...refs, { fieldMask: ['status'] });
      for (const member of snapshots) {
        members.set(member.id, { exists: member.exists, status: member.get('status') });
      }
    }
    const plan = planGroupMediaAccess(data, members);
    const { participantUids, ...counts } = plan;
    const needsUpdate = data.mediaAclVersion !== 2 || data.memberCount !== participantUids.length
      || !sameIds(data.participantUids, participantUids) || !sameIds(data.memberIds, participantUids);
    if (!needsUpdate) return { groupId, outcome: 'unchanged', ...counts };
    if (options.apply !== true) return { groupId, outcome: 'would-update', ...counts };
    transaction.update(conversationRef, {
      participantUids, memberIds: participantUids, memberCount: participantUids.length,
      mediaAclVersion: 2,
    });
    return { groupId, outcome: 'applied', ...counts };
  });
}

export function parseReconciliationArgs(args: readonly string[]): {
  projectId: string; apply: boolean; groupId?: string;
} {
  let projectId: string | undefined;
  let groupId: string | undefined;
  let apply = false;
  for (const arg of args) {
    if (arg === '--apply' && !apply) apply = true;
    else if (arg.startsWith('--project=') && projectId === undefined) projectId = arg.slice(10);
    else if (arg.startsWith('--group=') && groupId === undefined) groupId = arg.slice(8);
    else throw new Error('Use --project=<project-id>, optional --group=<conversation-id> and --apply.');
  }
  if (!projectId || !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(projectId)) {
    throw new Error('Pass an explicit --project=<Firebase project id>.');
  }
  if (groupId !== undefined && !validId(groupId)) throw new Error('Invalid --group.');
  return { projectId, apply, ...(groupId === undefined ? {} : { groupId }) };
}

export async function runReconciliationCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseReconciliationArgs(args);
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialsPath) {
    const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
    if (credentials.project_id && credentials.project_id !== options.projectId) {
      throw new Error('Credential project does not match --project.');
    }
  }
  const app = initializeApp({ projectId: options.projectId }, 'group-media-reconciliation');
  const firestore = getFirestore(app);
  const totals = { applied: 0, 'would-update': 0, unchanged: 0, skipped: 0, failed: 0 };
  console.log(JSON.stringify({ projectId: options.projectId, mode: options.apply ? 'apply' : 'dry-run' }));
  const processGroup = async (groupId: string) => {
    try {
      const result = await reconcileGroupMediaAccess(firestore, groupId, { apply: options.apply });
      totals[result.outcome]++;
      if (result.reason === 'invalid-canonical-membership') process.exitCode = 1;
      // Counts only: no contact details, member UIDs or credentials in logs.
      console.log(JSON.stringify(result));
    } catch (error) {
      totals.failed++;
      process.exitCode = 1;
      const code = (error as { code?: unknown })?.code;
      console.error(JSON.stringify({ groupId, outcome: 'failed',
        ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}) }));
    }
  };
  try {
    if (options.groupId) {
      await processGroup(options.groupId);
    } else {
      let lastId: string | undefined;
      for (;;) {
        let query = firestore.collection('conversations').where('type', '==', 'group')
          .orderBy(FieldPath.documentId()).select('type').limit(GROUP_PAGE_SIZE);
        if (lastId !== undefined) query = query.startAfter(lastId);
        const page = await query.get();
        if (page.empty) break;
        for (const group of page.docs) await processGroup(group.id);
        lastId = page.docs[page.docs.length - 1].id;
      }
    }
    console.log(JSON.stringify({ projectId: options.projectId, totals }));
  } finally {
    await deleteApp(app);
  }
}

// tsx runs this repository's scripts as CommonJS. Importing helpers in tests or
// another admin task must never initialize a client, scan groups or write data.
if (typeof require !== 'undefined' && require.main === module) {
  runReconciliationCli().catch(() => {
    console.error('Group media reconciliation failed. Check arguments, credentials and emulator/project configuration.');
    process.exitCode = 1;
  });
}
