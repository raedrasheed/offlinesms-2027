// Scheduled: keep Firebase Auth on each account's settled email address while
// any email-change Auth write of unknown outcome (or with a vanished worker)
// could still land. See ./authWrites.ts.

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { runReconcilePass } from './authWrites';

export const reconcileEmailChangeWrites = onSchedule(
  { schedule: 'every 15 minutes', timeZone: 'UTC', region: 'us-central1' },
  async () => { await runReconcilePass(); },
);
