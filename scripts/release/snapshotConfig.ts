// Production release — configuration snapshot (READ-ONLY).
//
// Saves, before any production change (docs/PRODUCTION_RELEASE.md §2), the
// settings the release touches or depends on, so every stage can be compared
// with and, where needed, set back by hand:
//   - every smsConfig/* and systemSettings/* document (verification-SMS policy
//     and limits, sender, providers, email sign-in and email-change switches);
//   - every relayDevices/* document's routing settings (status, caps, countries,
//     app version, last heartbeat, today's counters);
//   - relay jobs not yet finished and email changes mid-way (counts).
// Fields whose names look like credentials (key, secret, token, password, auth,
// pepper, hash of a credential) are replaced by "<redacted>": the release changes
// none of them, and the snapshot file must not become a copy of them. Relay push
// tokens are not read. Never writes to Firestore.
//
// This is not a data backup. The managed Firestore export in §2 is.
//
// Credentials: Application Default Credentials (your Cloud Shell login) with
// read access to Firestore.
//
// Usage:
//   npx tsx scripts/release/snapshotConfig.ts --project offlinesms-prod-2027 --out prod-config-before.json
//
// Exit code: 0 written · 2 bad invocation or read error.

import { writeFileSync } from 'node:fs';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const CREDENTIAL = /(key|secret|token|password|passwd|auth(?!orized)|pepper|credential|bearer|signature)/i;
// Settings that match the pattern by name but are not credentials, and that a rollback needs.
const KEEP = new Set(['androidAppHash', 'apiKeyPrefix']);

export function sanitize(v: unknown, key = ''): unknown {
  if (key && CREDENTIAL.test(key) && !KEEP.has(key)) return v == null ? v : '<redacted>';
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(x => sanitize(x));
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = sanitize(x, k);
    return o;
  }
  return v;
}

const RELAY_FIELDS = ['businessId', 'label', 'status', 'caps', 'allowedCountryCodes', 'countryRoutingEnabled',
  'appVersion', 'manufacturer', 'model', 'lastHeartbeatAt', 'counters', 'createdAt', 'updatedAt'];

async function main() {
  const project = arg('project');
  const out = arg('out');
  if (!project || !out) { console.error('usage: --project <id> --out <file.json>'); process.exit(2); }
  initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: project } : { credential: applicationDefault(), projectId: project });
  const db = getFirestore();
  const collection = async (name: string): Promise<Record<string, unknown>> => {
    const snap = await db.collection(name).get();
    return Object.fromEntries(snap.docs.map(d => [d.id, sanitize(d.data())]));
  };

  const smsConfig = await collection('smsConfig');
  const systemSettings = await collection('systemSettings');

  const relaySnap = await db.collection('relayDevices').select(...RELAY_FIELDS).get();
  const relayDevices = Object.fromEntries(relaySnap.docs.map(d => [d.id, sanitize(d.data())]));

  const openJobs: Record<string, number> = {};
  for (const s of ['queued', 'claimed', 'sending']) {
    openJobs[s] = (await db.collection('relayJobs').where('status', '==', s).count().get()).data().count;
  }
  const emailChangesMidway = (await db.collection('emailChangeOps')
    .where('stage', 'in', ['verified', 'auth-updated']).count().get()).data().count;

  const snapshot = {
    project,
    takenAt: new Date().toISOString(),
    smsConfig,
    systemSettings,
    relayDevices,
    counts: { relayJobsOpen: openJobs, emailChangesMidway },
  };
  writeFileSync(out, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 });

  const otp = (smsConfig.otp ?? {}) as Record<string, any>;
  console.log(`Configuration snapshot — project ${project} (read-only) → ${out}`);
  console.log(`  smsConfig docs            : ${Object.keys(smsConfig).join(', ') || 'none'}`);
  console.log(`  systemSettings docs       : ${Object.keys(systemSettings).join(', ') || 'none'}`);
  console.log(`  OTP policy                : enabled=${otp.enabled} emergencyStop=${otp.emergencyStop} signin=${otp.signin?.enabled} link=${otp.link?.enabled} v${otp.policyVersion}`);
  console.log(`  relay devices             : ${relaySnap.size} (${Object.values(relayDevices).map((d: any) => d.status).join(', ')})`);
  console.log(`  relay jobs not finished   : queued ${openJobs.queued}, claimed ${openJobs.claimed}, sending ${openJobs.sending}`);
  console.log(`  email changes mid-way     : ${emailChangesMidway}`);
}

if (process.argv[1] && /snapshotConfig\.ts$/.test(process.argv[1])) {
  main().catch(e => { console.error('read failed:', (e as Error).message); process.exit(2); });
}
