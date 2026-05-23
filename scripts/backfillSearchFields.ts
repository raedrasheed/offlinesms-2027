#!/usr/bin/env ts-node
// Backfill search normalization fields for Phase 18.
//
// Adds:
//   users.displayNameLower  = displayName.toLowerCase()
//   conversations.nameLower = name.toLowerCase()  (type=group only)
//
// Dry-run by default. Pass --write to commit changes.
//
// Usage:
//   npx ts-node scripts/backfillSearchFields.ts           # dry-run
//   npx ts-node scripts/backfillSearchFields.ts --write   # apply changes

import { initializeApp, cert, getApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as path from 'path';
import * as fs from 'fs';

const WRITE = process.argv.includes('--write');
const BATCH_SIZE = 400;

function initAdmin() {
  try { return getApp(); } catch { /* not initialized */ }
  const sa = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (sa && fs.existsSync(sa)) {
    return initializeApp({ credential: cert(sa) });
  }
  const localSa = path.join(__dirname, '../.service-account.json');
  if (fs.existsSync(localSa)) {
    return initializeApp({ credential: cert(localSa) });
  }
  return initializeApp();
}

async function backfillUsers(db: FirebaseFirestore.Firestore): Promise<number> {
  let updated = 0;
  let cursor: FirebaseFirestore.DocumentSnapshot | undefined;

  while (true) {
    let q = db.collection('users').orderBy('__name__').limit(BATCH_SIZE) as FirebaseFirestore.Query;
    if (cursor) q = q.startAfter(cursor);

    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let batchCount = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      const displayName = typeof data.displayName === 'string' ? data.displayName : null;
      const existing = data.displayNameLower;
      const expected = displayName ? displayName.toLowerCase() : null;

      if (expected !== null && existing !== expected) {
        if (WRITE) {
          batch.update(doc.ref, { displayNameLower: expected });
        } else {
          console.log(`[DRY-RUN] users/${doc.id}: displayNameLower = "${expected}"`);
        }
        batchCount++;
        updated++;
      }
    }

    if (WRITE && batchCount > 0) await batch.commit();
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < BATCH_SIZE) break;
  }

  return updated;
}

async function backfillGroups(db: FirebaseFirestore.Firestore): Promise<number> {
  let updated = 0;
  let cursor: FirebaseFirestore.DocumentSnapshot | undefined;

  while (true) {
    let q = db.collection('conversations')
      .where('type', '==', 'group')
      .orderBy('__name__')
      .limit(BATCH_SIZE) as FirebaseFirestore.Query;
    if (cursor) q = q.startAfter(cursor);

    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let batchCount = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      const name = typeof data.name === 'string' ? data.name : null;
      const existing = data.nameLower;
      const expected = name ? name.toLowerCase() : null;

      if (expected !== null && existing !== expected) {
        if (WRITE) {
          batch.update(doc.ref, { nameLower: expected });
        } else {
          console.log(`[DRY-RUN] conversations/${doc.id}: nameLower = "${expected}"`);
        }
        batchCount++;
        updated++;
      }
    }

    if (WRITE && batchCount > 0) await batch.commit();
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < BATCH_SIZE) break;
  }

  return updated;
}

async function main() {
  console.log(`Backfill mode: ${WRITE ? 'WRITE' : 'DRY-RUN'}`);
  initAdmin();
  const db = getFirestore();

  const [usersUpdated, groupsUpdated] = await Promise.all([
    backfillUsers(db),
    backfillGroups(db),
  ]);

  console.log(`\nSummary:`);
  console.log(`  users.displayNameLower: ${usersUpdated} ${WRITE ? 'updated' : 'would update'}`);
  console.log(`  conversations.nameLower: ${groupsUpdated} ${WRITE ? 'updated' : 'would update'}`);
  if (!WRITE) {
    console.log(`\nRe-run with --write to apply changes.`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
