// Phase 1 remediation for the public phone-OTP abuse — DRY-RUN BY DEFAULT.
//
// Read docs/PHONE_LINKING_SECURITY.md §Production remediation before running.
// Deploying the Phase 1 functions already stops all new public OTP SMS and makes
// the relay refuse any queued legacy OTP job; this script reports what the
// abuse left behind and (only with --apply) neutralizes leftovers.
//
// Reports (counts only — never numbers, codes, emails or uids):
//   • otpChallenges docs (hashed sign-in codes, now inert)
//   • relayJobs kind 'otp' by status, and how many still hold a message body
//   • auditLogs auth.otp.* rows (by day) and how many carry a raw phone targetId
//   • Auth users that are phone-only (no email), created since --since
//
// --apply (requires --project=<projectId> matching the target):
//   • relayJobs kind 'otp' in queued/claimed/sending → failed ('public-otp-disabled'),
//     message body (contains the code) deleted
//   • message body deleted from any other legacy 'otp' job that still has one
//   • otpChallenges deleted
// --redact-audit (separately, with --apply): replace raw phone targetIds on
//   auth.otp.* audit rows with a redacted form. This DESTROYS forensic detail
//   (which numbers were targeted), so it REQUIRES --forensic-export=<file>: the
//   untouched rows (id, action, targetId, createdAt) are first written to that
//   local file with owner-only permissions (0600) for restricted retention.
//   Pass --no-forensic-export only if the owner explicitly decided to discard it.
//
// Already-claimed work: jobs in claimed/sending may already be on a relay phone.
// Cancelling them server-side stops current relay builds (they must obtain
// authorizeRelaySend, which refuses legacy 'otp' jobs) and stops any retry, but
// an OLD relay build that already received the body sends without asking, and
// anything handed to the modem cannot be recalled. The report counts these
// separately (`inFlightPossiblyOnDevice`).
//
// NEVER deletes or disables Auth users: phone-only accounts created during the
// abuse need a product decision (see the doc). NEVER sends anything.
//
// Dry-run:  GOOGLE_APPLICATION_CREDENTIALS=./sa.json npx tsx scripts/remediatePhoneOtpAbuse.ts --since=2026-09-01
// Apply:    GOOGLE_APPLICATION_CREDENTIALS=./sa.json npx tsx scripts/remediatePhoneOtpAbuse.ts --apply --project=<id>
// Emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GCLOUD_PROJECT=demo-x npx tsx scripts/remediatePhoneOtpAbuse.ts

import { FieldValue, type Firestore, type Timestamp } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';

export interface RemediationOptions {
  apply: boolean;
  redactAudit: boolean;
  sinceMs: number | null;
  /** Called with the raw audit rows BEFORE redaction; must persist them. */
  forensicExport?: (rows: Array<Record<string, unknown>>) => Promise<void>;
  /** Owner explicitly chose to redact without keeping a forensic copy. */
  noForensicExport?: boolean;
}

export interface RemediationReport {
  mode: 'dry-run' | 'apply';
  otpChallenges: number;
  otpJobsByStatus: Record<string, number>;
  otpJobsWithBody: number;
  otpAuditRows: number;
  otpAuditRowsByDay: Record<string, number>;
  otpAuditRowsWithRawPhone: number;
  phoneOnlyAuthUsersSince: number;
  /** Legacy OTP jobs claimed/sending: a relay may already hold (or have sent) the body. */
  inFlightPossiblyOnDevice: number;
  forensicRowsExported: number;
  applied: { jobsCancelled: number; bodiesPurged: number; challengesDeleted: number; auditRedacted: number };
}

const IN_FLIGHT = new Set(['queued', 'claimed', 'sending']);
const RAW_PHONE_ID = /^\+?\d{7,15}$/;

function redact(id: string): string {
  const d = id.replace(/\D/g, '');
  return '+' + '•'.repeat(Math.max(0, d.length - 2)) + d.slice(-2);
}

async function inBatches<T>(items: T[], fn: (batch: FirebaseFirestore.WriteBatch, item: T) => void, db: Firestore) {
  for (let i = 0; i < items.length; i += 400) {
    const b = db.batch();
    items.slice(i, i + 400).forEach(it => fn(b, it));
    await b.commit();
  }
}

export async function runRemediation(db: Firestore, auth: Auth, o: RemediationOptions): Promise<RemediationReport> {
  const r: RemediationReport = {
    mode: o.apply ? 'apply' : 'dry-run',
    otpChallenges: 0, otpJobsByStatus: {}, otpJobsWithBody: 0,
    otpAuditRows: 0, otpAuditRowsByDay: {}, otpAuditRowsWithRawPhone: 0,
    phoneOnlyAuthUsersSince: 0,
    inFlightPossiblyOnDevice: 0,
    forensicRowsExported: 0,
    applied: { jobsCancelled: 0, bodiesPurged: 0, challengesDeleted: 0, auditRedacted: 0 },
  };

  const challenges = await db.collection('otpChallenges').get();
  r.otpChallenges = challenges.size;

  const jobs = await db.collection('relayJobs').where('kind', '==', 'otp').get();
  const toCancel: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  const toPurge: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (const j of jobs.docs) {
    const st = String(j.get('status') ?? 'unknown');
    r.otpJobsByStatus[st] = (r.otpJobsByStatus[st] ?? 0) + 1;
    const hasBody = j.get('messageBody') != null;
    if (hasBody) r.otpJobsWithBody++;
    if (st === 'claimed' || st === 'sending') r.inFlightPossiblyOnDevice++;
    if (IN_FLIGHT.has(st)) toCancel.push(j);
    else if (hasBody) toPurge.push(j);
  }

  const audit = await db.collection('auditLogs').where('action', 'in', ['auth.otp.requested', 'auth.otp.verified']).get();
  r.otpAuditRows = audit.size;
  const rawRows: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (const a of audit.docs) {
    const at = (a.get('createdAt') as Timestamp | undefined)?.toDate?.();
    const day = at ? at.toISOString().slice(0, 10) : 'unknown';
    r.otpAuditRowsByDay[day] = (r.otpAuditRowsByDay[day] ?? 0) + 1;
    const tid = a.get('targetId');
    if (typeof tid === 'string' && RAW_PHONE_ID.test(tid)) { r.otpAuditRowsWithRawPhone++; rawRows.push(a); }
  }

  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      if (!u.phoneNumber || u.email) continue;
      const created = Date.parse(u.metadata.creationTime);
      if (o.sinceMs == null || created >= o.sinceMs) r.phoneOnlyAuthUsersSince++;
    }
    pageToken = page.pageToken;
  } while (pageToken);

  if (!o.apply) return r;

  await inBatches(toCancel, (b, j) => b.update(j.ref, {
    status: 'failed', failedAt: FieldValue.serverTimestamp(), lastError: 'public-otp-disabled',
    messageBody: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(),
  }), db);
  r.applied.jobsCancelled = toCancel.length;
  await inBatches(toPurge, (b, j) => b.update(j.ref, { messageBody: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }), db);
  r.applied.bodiesPurged = toPurge.length;
  await inBatches(challenges.docs, (b, c) => b.delete(c.ref), db);
  r.applied.challengesDeleted = challenges.size;
  if (o.redactAudit) {
    if (!o.forensicExport && !o.noForensicExport) throw new Error('redact-audit requires a forensic export (or an explicit opt-out)');
    if (o.forensicExport && rawRows.length > 0) {
      await o.forensicExport(rawRows.map(a => ({
        id: a.id, action: a.get('action'), targetId: a.get('targetId'),
        createdAt: (a.get('createdAt') as Timestamp | undefined)?.toDate?.()?.toISOString() ?? null,
      })));
      r.forensicRowsExported = rawRows.length;
    }
    await inBatches(rawRows, (b, a) => b.update(a.ref, { targetId: redact(String(a.get('targetId'))) }), db);
    r.applied.auditRedacted = rawRows.length;
  }
  return r;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { getAuth } = await import('firebase-admin/auth');
  const { readFileSync, writeFileSync, existsSync } = await import('node:fs');

  const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  const apply = process.argv.includes('--apply');
  const redactAudit = process.argv.includes('--redact-audit');
  const sinceRaw = arg('since');
  const sinceMs = sinceRaw ? Date.parse(sinceRaw) : null;
  if (sinceRaw && !Number.isFinite(sinceMs)) { console.error('Bad --since date'); process.exit(2); }
  if (redactAudit && !apply) { console.error('--redact-audit requires --apply'); process.exit(2); }
  const exportPath = arg('forensic-export');
  const noExport = process.argv.includes('--no-forensic-export');
  if (redactAudit && !exportPath && !noExport) {
    console.error('NO-GO: --redact-audit needs --forensic-export=<file> (restricted copy) or an explicit --no-forensic-export');
    process.exit(2);
  }
  if (exportPath && existsSync(exportPath)) { console.error('NO-GO: forensic export file already exists'); process.exit(2); }
  const forensicExport = exportPath
    ? async (rows: Array<Record<string, unknown>>) => { writeFileSync(exportPath, JSON.stringify(rows, null, 2), { mode: 0o600, flag: 'wx' }); }
    : undefined;

  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  let projectId: string | undefined;
  if (getApps().length === 0) {
    if (emulator) {
      projectId = process.env.GCLOUD_PROJECT;
      initializeApp({ projectId });
    } else {
      const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (!credPath) { console.error('NO-GO: set GOOGLE_APPLICATION_CREDENTIALS'); process.exit(2); }
      const sa = JSON.parse(readFileSync(credPath, 'utf-8'));
      projectId = sa.project_id;
      initializeApp({ credential: cert(sa) });
    }
  }
  if (apply && arg('project') !== projectId) {
    console.error(`NO-GO: --apply requires --project=${projectId ?? '<project>'} (must match the target project)`);
    process.exit(2);
  }
  const report = await runRemediation(getFirestore(), getAuth(), { apply, redactAudit, sinceMs, forensicExport, noForensicExport: noExport });
  console.log(JSON.stringify({ projectId, ...report }, null, 2));
}

if (process.argv[1] && /remediatePhoneOtpAbuse\.ts$/.test(process.argv[1])) {
  main().catch(e => { console.error('remediation failed:', (e as Error)?.message); process.exit(1); });
}
