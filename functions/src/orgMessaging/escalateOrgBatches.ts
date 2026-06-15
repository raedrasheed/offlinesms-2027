// Scheduled sweeper: SMS escalation for Organization Messaging batches.
//
// Every minute, finds organizationMessageBatches whose escalateAt has passed
// (escalationStatus == 'scheduled'), refreshes each recipient's status from
// the REAL in-app receipts (queued → delivered/read), then escalates the
// recipients still matching the batch's audience (unread_only /
// undelivered_only / everyone — exactly the app's escalation options) to SMS.
//
// SMS sending REUSES the existing engine end-to-end: classifyRecipients
// (phones, opt-out, verification), provider routing (HTTP gateway / relay /
// hybrid), smsBatches docs + per-recipient rows, and the existing
// onSmsBatchAccepted settlement — billed to the organization's points wallet
// (wallets/orgsender_<orgId>), reservation/refund semantics unchanged.

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { classifyRecipients, COST_PER_SMS, MAX_RECIPIENTS_PER_BATCH } from '../sms/recipients';
import { sendBatch } from '../sms/gateway';
import { partitionRecipientsByCoverage } from '../sms/countryRouting';
import { resolveProvider } from '../sms/provider';
import { relayModeEngaged, isHybrid } from '../sms/relayLogic';
import { dispatchBatchToRelay } from '../sms/relayDispatcher';
import { maybeFinalizeRelayBatch } from '../sms/relaySettlement';
import { writeAuditLog } from '../lib/auditLog';
import {
  audienceIncludes, composeSmsText, groupBySmsText, receiptToRowStatus,
  type OrgEscalationAudience,
} from './orgEscalationLogic';

const BATCHES_PER_RUN = 5;
const ROWS_MAX = 600;

type RowRef = {
  ref:            FirebaseFirestore.DocumentReference;
  uid:            string;            // resolvedUserId
  conversationId: string;
  messageId:      string;
  title:          string;
  body:           string;
  status:         string;            // queued | delivered | read
  receipt:        string | null;
  smsText:        string;
};

export const escalateOrgBatches = onSchedule(
  { schedule: 'every 1 minutes', timeZone: 'UTC' },
  async () => {
    const db = getFirestore();
    const due = await db.collection('organizationMessageBatches')
      .where('escalationStatus', '==', 'scheduled')
      .where('escalateAt', '<=', Timestamp.now())
      .limit(BATCHES_PER_RUN)
      .get();

    for (const batchDoc of due.docs) {
      // Claim the batch first so a slow run can't double-escalate.
      try {
        await db.runTransaction(async tx => {
          const fresh = await tx.get(batchDoc.ref);
          if (fresh.data()?.escalationStatus !== 'scheduled') throw new Error('claimed');
          tx.update(batchDoc.ref, { escalationStatus: 'processing', updatedAt: FieldValue.serverTimestamp() });
        });
      } catch { continue; }

      try {
        await processBatch(db, batchDoc.id, batchDoc.data() as Record<string, unknown>);
      } catch (e) {
        try {
          await batchDoc.ref.update({ escalationStatus: 'failed', updatedAt: FieldValue.serverTimestamp() });
        } catch { /* best-effort */ }
        await writeAuditLog({
          action: 'organization_message_batch_failed',
          actor:  { uid: 'system:org-escalation' },
          target: { type: 'organization', id: (batchDoc.data().organizationId as string) ?? '' },
          result: 'failure',
          metadata: { batchId: batchDoc.id, reason: 'escalation-error' },
        });
      }
    }
  },
);

async function processBatch(
  db: FirebaseFirestore.Firestore,
  batchId: string,
  batch: Record<string, unknown>,
) {
  const organizationId = (batch.organizationId as string) ?? '';
  const escalation = (batch.escalation as { audience?: string } | undefined) ?? {};
  const audience = (['unread_only', 'undelivered_only', 'everyone'].includes(escalation.audience as string)
    ? escalation.audience : 'unread_only') as OrgEscalationAudience;
  const senderUid = `orgsender_${organizationId}`;
  const batchRef = db.collection('organizationMessageBatches').doc(batchId);

  // 1 — Load the batch's delivered rows (those with a real in-app message).
  const rowsSnap = await db.collection('organizationMessages')
    .where('batchId', '==', batchId).limit(ROWS_MAX).get();
  const rows: RowRef[] = [];
  for (const d of rowsSnap.docs) {
    const x = d.data() as Record<string, unknown>;
    if (!x.resolvedUserId || !x.conversationId || !x.messageId) continue;
    rows.push({
      ref: d.ref,
      uid: x.resolvedUserId as string,
      conversationId: x.conversationId as string,
      messageId: x.messageId as string,
      title: (x.title as string) ?? '',
      body: (x.body as string) ?? '',
      status: (x.status as string) ?? 'queued',
      receipt: null,
      smsText: '',
    });
  }

  // 2 — Refresh receipt-backed statuses from the app's real receipts.
  if (rows.length > 0) {
    const receiptRefs = rows.map(r =>
      db.collection('conversations').doc(r.conversationId)
        .collection('messages').doc(r.messageId)
        .collection('receipts').doc(r.uid));
    const receiptSnaps = await db.getAll(...receiptRefs);
    const statusWrites = db.batch();
    let dirty = 0;
    let delivered = 0;
    let read = 0;
    const RANK: Record<string, number> = { queued: 0, delivered: 1, read: 2 };
    receiptSnaps.forEach((snap, i) => {
      const receipt = (snap.data()?.status as string | undefined) ?? null;
      rows[i].receipt = receipt;
      const next = receiptToRowStatus(receipt);
      if (next === 'read') read++;
      if (next === 'read' || next === 'delivered') delivered++;
      // Monotonic upgrade only: queued → delivered → read.
      if ((RANK[next] ?? 0) > (RANK[rows[i].status] ?? 0)) {
        statusWrites.update(rows[i].ref, { status: next, updatedAt: FieldValue.serverTimestamp() });
        rows[i].status = next;
        dirty++;
      }
    });
    if (dirty > 0) await statusWrites.commit();
    await batchRef.update({ delivered, read, updatedAt: FieldValue.serverTimestamp() });
  }

  // 3 — Audience filter (the app's three options) → SMS candidates.
  const targets = rows.filter(r => audienceIncludes(audience, r.receipt));
  if (targets.length === 0) {
    await batchRef.update({
      escalationStatus: 'completed', escalatedAt: FieldValue.serverTimestamp(),
      smsQueued: 0, smsFailed: 0, smsSkipped: 0,
    });
    return;
  }

  // 4 — Eligibility (phones, opt-out, verification) — the app's classifier.
  const { eligible, excluded } = await classifyRecipients(
    db, targets.map(t => ({ uid: t.uid, appReceiptStatus: t.receipt })));

  const rowByUid = new Map(targets.map(t => [t.uid, t]));
  const skippedWrites = db.batch();
  for (const e of excluded) {
    const row = rowByUid.get(e.uid);
    if (row) skippedWrites.update(row.ref, { smsEscalation: 'skipped', smsSkipReason: e.skipReason, updatedAt: FieldValue.serverTimestamp() });
  }
  if (excluded.length > 0) await skippedWrites.commit();

  // Country-based relay routing — enforced for EVERY provider mode (relay AND
  // HTTP). A recipient whose detected country has no eligible relay is NOT sent
  // to (the relay dispatcher re-checks too, but this also gates the HTTP path
  // and avoids reserving points for recipients we won't send to).
  const { uncovered } = await partitionRecipientsByCoverage(
    organizationId, eligible.map(e => ({ id: e.uid, phoneE164: e.phone })));
  let noRelaySkipped = 0;
  if (uncovered.length > 0) {
    const uncoveredIds = new Set(uncovered.map(u => u.id));
    const covWrites = db.batch();
    for (const u of uncovered) {
      const row = rowByUid.get(u.id);
      if (row) covWrites.update(row.ref, { smsEscalation: 'skipped', smsSkipReason: u.reason, updatedAt: FieldValue.serverTimestamp() });
    }
    await covWrites.commit();
    for (let i = eligible.length - 1; i >= 0; i--) {
      if (uncoveredIds.has(eligible[i].uid)) eligible.splice(i, 1);
    }
    noRelaySkipped = uncovered.length;
  }

  if (eligible.length === 0) {
    await batchRef.update({
      escalationStatus: 'completed', escalatedAt: FieldValue.serverTimestamp(),
      smsQueued: 0, smsFailed: 0, smsSkipped: excluded.length + noRelaySkipped,
    });
    return;
  }

  // 5 — Reserve points from the org wallet (same transaction shape as
  //     escalateSms; settlement/refund handled by onSmsBatchAccepted).
  const sendable = eligible.slice(0, MAX_RECIPIENTS_PER_BATCH);
  const cost = sendable.length * COST_PER_SMS;
  const walletRef = db.collection('wallets').doc(senderUid);
  try {
    await db.runTransaction(async tx => {
      const w = await tx.get(walletRef);
      const balance = w.exists ? ((w.get('balance') as number) ?? 0) : 0;
      if (balance < cost) throw new Error('not-enough-points');
      tx.set(walletRef, { balance: balance - cost, reserved: FieldValue.increment(cost) }, { merge: true });
    });
  } catch {
    await batchRef.update({
      escalationStatus: 'insufficient_points', escalatedAt: FieldValue.serverTimestamp(),
      smsQueued: 0, smsFailed: 0, smsSkipped: excluded.length + noRelaySkipped, smsCostNeeded: cost,
    });
    await writeAuditLog({
      action: 'organization_message_batch_failed',
      actor:  { uid: `system:orgsender_${organizationId}` },
      target: { type: 'organization', id: organizationId },
      result: 'failure',
      metadata: { batchId, reason: 'insufficient_points', needed: cost, eligible: sendable.length },
    });
    return;
  }

  await db.collection('transactions').add({
    userId: senderUid, type: 'reservation', direction: 'debit', amount: cost,
    status: 'completed', relatedSmsBatchId: batchId,
    note: 'org-messaging-escalation',
    createdAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp(),
  });

  // 6 — Send. One smsBatches doc per distinct SMS text (shape B may carry a
  //     different body per recipient), each settled by the existing trigger.
  const eligByUid = new Map(sendable.map(e => [e.uid, e]));
  const sendRows = sendable.map(e => {
    const row = rowByUid.get(e.uid)!;
    row.smsText = composeSmsText(row.title, row.body);
    return row;
  });
  const groups = groupBySmsText(sendRows);
  const providerMode = await resolveProvider(organizationId);
  let smsQueued = 0;
  let smsFailed = 0;

  for (const [smsText, groupRows] of groups) {
    const groupEligible = groupRows.map(r => eligByUid.get(r.uid)!);
    const smsBatchRef = db.collection('smsBatches').doc();
    const now = FieldValue.serverTimestamp();
    const groupCost = groupEligible.length * COST_PER_SMS;
    await smsBatchRef.set({
      messageId:         `orgbatch_${batchId}`,
      conversationId:    null,
      orgBatchId:        batchId,
      organizationId,
      senderId:          senderUid,
      audience:          audience,
      audienceCanonical: audience,
      smsBody:           smsText,
      recipientCount:    groupEligible.length,
      eligibleCount:     groupEligible.length,
      excludedCount:     0,
      totalCount:        groupEligible.length,
      queuedCount:       groupEligible.length,
      sentCount:         0,
      deliveredCount:    0,
      failedCount:       0,
      estimatedCost:     groupCost,
      pointsCost:        groupCost,
      pointsReserved:    groupCost,
      pointsDeducted:    null,
      pointsRefunded:    null,
      status:            'sending',
      gatewayBatchId:    null,
      offlineSmsBatchId: null,
      retryOfBatchId:    null,
      createdAt:         now,
      updatedAt:         now,
    });

    if (relayModeEngaged(providerMode)) {
      // Relay path — recipients queued, dispatcher routes to org devices;
      // hybrid falls back to the HTTP gateway for unrouted recipients.
      const recipWrites = db.batch();
      for (const e of groupEligible) {
        recipWrites.set(smsBatchRef.collection('recipients').doc(e.uid), {
          userId: e.uid, maskedPhone: e.maskedPhone, appReceiptStatus: e.appReceiptStatus,
          smsStatus: 'queued', skipReason: null, reason: null, updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await recipWrites.commit();
      const hybrid = isHybrid(providerMode);
      const dispatch = await dispatchBatchToRelay(smsBatchRef.id, organizationId, { allowUnassignedQueue: !hybrid });
      let groupFailed = 0;
      if (hybrid && dispatch.unrouted.length > 0) {
        const fb = groupEligible.filter(e => dispatch.unrouted.includes(e.uid));
        const fbWrites = db.batch();
        try {
          const r = await sendBatch(smsBatchRef.id, smsText, fb.map(e => ({ uid: e.uid, phone: e.phone, maskedPhone: e.maskedPhone })));
          for (const e of fb) {
            const ok = r.acceptedRecipientIds.includes(e.uid);
            if (!ok) groupFailed++;
            fbWrites.set(smsBatchRef.collection('recipients').doc(e.uid),
              { smsStatus: ok ? 'queued' : 'failed', reason: ok ? null : 'gateway-error', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          }
        } catch {
          groupFailed += fb.length;
          for (const e of fb) fbWrites.set(smsBatchRef.collection('recipients').doc(e.uid),
            { smsStatus: 'failed', reason: 'gateway-error', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
        await fbWrites.commit();
      }
      await smsBatchRef.update({ provider: providerMode, updatedAt: FieldValue.serverTimestamp() });
      if (dispatch.routed === 0) await maybeFinalizeRelayBatch(smsBatchRef.id);
      smsQueued += groupEligible.length - groupFailed;
      smsFailed += groupFailed;
      const rowWrites = db.batch();
      for (const row of groupRows) rowWrites.update(row.ref, { smsEscalation: 'queued', smsBatchId: smsBatchRef.id, updatedAt: FieldValue.serverTimestamp() });
      await rowWrites.commit();
      continue;
    }

    // HTTP gateway path.
    let queuedUids = new Set<string>();
    try {
      const result = await sendBatch(
        smsBatchRef.id, smsText,
        groupEligible.map(e => ({ uid: e.uid, phone: e.phone, maskedPhone: e.maskedPhone })),
      );
      queuedUids = new Set(result.acceptedRecipientIds);
      const failedCount = groupEligible.length - queuedUids.size;
      const finalStatus = failedCount === 0 ? 'accepted' : failedCount === groupEligible.length ? 'failed' : 'partial';
      const sends = db.batch();
      for (const e of groupEligible) {
        const ok = queuedUids.has(e.uid);
        sends.set(smsBatchRef.collection('recipients').doc(e.uid), {
          userId: e.uid, maskedPhone: e.maskedPhone, appReceiptStatus: e.appReceiptStatus,
          smsStatus: ok ? 'queued' : 'failed', skipReason: null,
          reason: ok ? null : 'gateway-error', updatedAt: FieldValue.serverTimestamp(),
        });
      }
      sends.update(smsBatchRef, {
        status: finalStatus,
        gatewayBatchId: result.gatewayBatchId, offlineSmsBatchId: result.gatewayBatchId,
        queuedCount: queuedUids.size, failedCount, updatedAt: FieldValue.serverTimestamp(),
      });
      await sends.commit();   // onSmsBatchAccepted settles points/refunds
    } catch {
      await smsBatchRef.update({ status: 'failed', updatedAt: FieldValue.serverTimestamp() });
    }

    const rowWrites = db.batch();
    for (const row of groupRows) {
      const ok = queuedUids.has(row.uid);
      if (ok) smsQueued++; else smsFailed++;
      rowWrites.update(row.ref, {
        smsEscalation: ok ? 'queued' : 'failed',
        smsBatchId: smsBatchRef.id,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await rowWrites.commit();
  }

  // 7 — Finalize the org batch + audit (counts only).
  await batchRef.update({
    escalationStatus: 'completed',
    escalatedAt: FieldValue.serverTimestamp(),
    smsQueued, smsFailed, smsSkipped: excluded.length + noRelaySkipped,
    smsPointsReserved: cost,
  });
  await writeAuditLog({
    action: 'organization_message_batch_escalated',
    actor:  { uid: `system:orgsender_${organizationId}` },
    target: { type: 'organization', id: organizationId },
    result: 'success',
    metadata: {
      batchId, audience,
      targeted: targets.length, eligible: sendable.length,
      smsQueued, smsFailed, skipped: excluded.length + noRelaySkipped,
      noRelayForCountry: noRelaySkipped, pointsReserved: cost,
    },
  });
}
