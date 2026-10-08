// Generation-conditional cleanup of QUEUED verification jobs (N6).
//
// When the OTP policy changes (sender, master/purpose switches, emergency stop,
// policyVersion), queued codes admitted under the old generation must never go
// out. Delivery is already blocked at claim and at final authorization; this
// sweep additionally purges their bodies promptly. It is:
//   • conditional — each job is re-read in its own transaction together with the
//     CURRENT policy, and is cancelled only if it is still `queued` AND invalid
//     under that policy (legacy public OTP, expired, stopped, other sender, other
//     generation). New-generation work and anything already claimed/sent/
//     delivered is never touched;
//   • paginated — walks every queued job of each verification kind by document
//     id, bounded per run; relayReaper calls it every minute, and the
//     smsConfig/otp trigger calls it on every policy change, so a large backlog
//     is finished over successive runs.

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue, FieldPath, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { PUBLIC_OTP_JOB_KIND, PHONE_AUTH_JOB_KIND, PHONE_LINK_JOB_KIND, verificationPurposeOf } from '../sms/relayLogic';
import { OTP_POLICY_DOC, verificationJobStillValid } from './policy';
import { writeAuditLog } from '../lib/auditLog';

const KINDS = [PUBLIC_OTP_JOB_KIND, PHONE_AUTH_JOB_KIND, PHONE_LINK_JOB_KIND];
const PAGE = 200;

/** Test seam: runs between the page query and each job's transaction. */
export const sweepDeps = { beforeJobTx: async (_jobId: string): Promise<void> => { /* no-op */ } };

export interface SweepResult { scanned: number; cancelled: number; complete: boolean }

export async function sweepStaleVerificationJobs(
  db: Firestore = getFirestore(), maxPages = 25,
): Promise<SweepResult> {
  const policyRef = db.collection(OTP_POLICY_DOC.collection).doc(OTP_POLICY_DOC.doc);
  let scanned = 0, cancelled = 0, pages = 0;
  for (const kind of KINDS) {
    let cursor: string | null = null;
    for (;;) {
      if (pages >= maxPages) return { scanned, cancelled, complete: false };
      let q = db.collection('relayJobs').where('kind', '==', kind).where('status', '==', 'queued')
        .orderBy(FieldPath.documentId()).limit(PAGE);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      pages++;
      for (const doc of snap.docs) {
        scanned++;
        await sweepDeps.beforeJobTx(doc.id);
        const did = await db.runTransaction(async tx => {
          const [job, pol] = await tx.getAll(doc.ref, policyRef);
          if (!job.exists || job.get('status') !== 'queued') return false; // claimed/sent/terminal: never overwrite
          const now = Date.now();
          const verdict = job.get('kind') === PUBLIC_OTP_JOB_KIND ? 'public-otp-disabled' : verificationJobStillValid({
            purpose: verificationPurposeOf(job.get('kind')),
            businessId: job.get('businessId'), policyVersion: job.get('policyVersion'),
            expiresAtMs: (job.get('expiresAt') as Timestamp | undefined)?.toMillis?.() ?? null,
          }, pol.exists ? (pol.data() ?? {}) : null, now);
          if (verdict === 'ok') return false; // valid under the CURRENT generation
          tx.update(doc.ref, {
            status: 'failed', failedAt: FieldValue.serverTimestamp(), lastError: verdict,
            messageBody: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(),
          });
          return true;
        });
        if (did) cancelled++;
      }
      if (snap.size < PAGE) break;
      cursor = snap.docs[snap.docs.length - 1].id;
    }
  }
  if (cancelled > 0) {
    await writeAuditLog({ action: 'relay.verification.cancelled', actor: { uid: 'system' }, target: { type: 'relayJobs', id: 'sweep' }, result: 'success', metadata: { count: cancelled } });
  }
  return { scanned, cancelled, complete: true };
}

/** Policy changed (dashboard action, script, console) → sweep stale queued codes. */
export const onOtpPolicyWritten = onDocumentWritten(`${OTP_POLICY_DOC.collection}/${OTP_POLICY_DOC.doc}`, async (event) => {
  const b = event.data?.before?.data() ?? {};
  const a = event.data?.after?.data() ?? {};
  const keys = ['policyVersion', 'businessId', 'enabled', 'emergencyStop'] as const;
  const changed = keys.some(k => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    || JSON.stringify(b.signin?.enabled) !== JSON.stringify(a.signin?.enabled)
    || JSON.stringify(b.link?.enabled) !== JSON.stringify(a.link?.enabled);
  if (!changed) return;
  try { await sweepStaleVerificationJobs(); } catch (e) {
    console.error('[otpPolicy] sweep failed; relayReaper retries every minute', (e as Error)?.message);
  }
});
