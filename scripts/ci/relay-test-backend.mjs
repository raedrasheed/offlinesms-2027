// Prepare a private, functional relay APK from the existing project config.
// Never upload google-services.json or silently substitute a fake backend.
//
// TEST_BACKEND=default (push, pull_request, or Run workflow with the default):
//   MOBILE_GOOGLE_SERVICES_JSON + MOBILE_TEST_FIREBASE_PROJECT_ID. Absent → the
//   functional APK is skipped. Production needs MOBILE_TEST_ALLOW_PRODUCTION_BACKEND=true.
// TEST_BACKEND=staging (Run workflow with test_backend=staging):
//   MOBILE_STAGING_GOOGLE_SERVICES_JSON + MOBILE_STAGING_FIREBASE_PROJECT_ID only.
//   Anything missing or wrong fails the job: it never falls back to the
//   default settings. Refused: production (no opt-in exists for staging), a
//   file of another project than the variable, no Android app
//   app.offlinesms.business, an app id of another project, and an API key
//   that Identity Toolkit does not resolve to the staging project.
//
// Writes apps/mobile-relay/app/google-services.json (relative to the working
// directory) with only the relay's client, and sets the step outputs
// ready=true and project=<id>. Prints no key values.
import fs from 'node:fs';
import { apiKeyProject, appIdNumber, keyBelongsTo } from './firebase-api-key.mjs';

const PROD = 'offlinesms-prod-2027';
const RELAY_PKG = 'app.offlinesms.business';
const OUT = 'apps/mobile-relay/app/google-services.json';
const env = name => (process.env[name] ?? '').trim();

const mode = env('TEST_BACKEND') || 'default';
if (mode !== 'default' && mode !== 'staging') throw new Error(`TEST_BACKEND must be default or staging, not "${mode}"`);
const staging = mode === 'staging';

function stop(msg) {
  console.error(`relay backend (${mode}): ${msg}`);
  process.exit(1);
}

const raw = staging ? env('MOBILE_STAGING_GOOGLE_SERVICES_JSON') : env('MOBILE_GOOGLE_SERVICES_JSON');
const expected = staging ? env('MOBILE_STAGING_FIREBASE_PROJECT_ID') : env('MOBILE_TEST_FIREBASE_PROJECT_ID');
if (staging) {
  const missing = [
    !raw && 'secret MOBILE_STAGING_GOOGLE_SERVICES_JSON',
    !expected && 'variable MOBILE_STAGING_FIREBASE_PROJECT_ID',
  ].filter(Boolean);
  if (missing.length) stop(`${missing.join(' and ')} missing; the staging relay is never built from the default settings`);
} else if (!raw) {
  console.log('Functional relay APK skipped: Firebase build config is absent.');
  process.exit(0);
}

let config;
try { config = JSON.parse(raw); } catch { stop('google-services.json is not JSON'); }
const project = config.project_info?.project_id;
const number = String(config.project_info?.project_number ?? '');
if (!project || project !== expected) {
  stop(`google-services.json belongs to another project than ${staging ? 'MOBILE_STAGING' : 'MOBILE_TEST'}_FIREBASE_PROJECT_ID`);
}
if (project === PROD) {
  if (staging) stop('staging settings point at the production project');
  if (env('MOBILE_TEST_ALLOW_PRODUCTION_BACKEND') !== 'true') stop('Production backend requires the existing explicit opt-in');
}
const client = config.client?.find(c => c.client_info?.android_client_info?.package_name === RELAY_PKG);
const appId = client?.client_info?.mobilesdk_app_id;
const key = client?.api_key?.[0]?.current_key;
if (!appId || !key) stop(`Firebase config must include Android app ${RELAY_PKG}`);

if (staging) {
  if (!number) stop('google-services.json has no project_number');
  if (appIdNumber(appId) !== number) stop(`the ${RELAY_PKG} app id is not an app of ${project}`);
  const res = await apiKeyProject(key);
  if (!res.ok) stop(`${RELAY_PKG} API key: ${res.reason}`);
  if (!keyBelongsTo(res, project, number)) stop(`${RELAY_PKG} API key belongs to another project`);
}

fs.writeFileSync(OUT, JSON.stringify({ ...config, client: [client] }));
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `ready=true\nproject=${project}\n`);
console.log(`Private relay APK configured for ${project} (${mode}).`);
