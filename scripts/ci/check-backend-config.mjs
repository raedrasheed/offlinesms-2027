#!/usr/bin/env node
// Checks that a test build's backend settings all point at ONE Firebase project
// before anything is built. Used by CI for staging builds (test_backend=staging):
//
//   node scripts/ci/check-backend-config.mjs --staging
//
// Reads MOBILE_GOOGLE_SERVICES_JSON (the Android google-services.json) and the
// web config the JS SDK uses: EXPO_PUBLIC_FIREBASE_{API_KEY,AUTH_DOMAIN,
// PROJECT_ID,STORAGE_BUCKET,APP_ID,MESSAGING_SENDER_ID}. It refuses:
//   - any missing value;
//   - a google-services.json without an Android client for the test package;
//   - a google-services.json for another project than PROJECT_ID, or a project
//     number other than MESSAGING_SENDER_ID; app ids of another project;
//   - a storage bucket of another project;
//   - an API key (web or Android) that Identity Toolkit does not resolve to
//     this project. Auth requests go wherever the key belongs, whatever the
//     project id says, so the key itself is checked: GET /v1/projects?key=…
//     returns the key's project (public endpoint, no credentials);
//   - an authDomain that project does not list as authorized;
//   - with --staging: the production project.
// Prints no key values.

import { apiKeyProject, appIdNumber, keyBelongsTo } from './firebase-api-key.mjs';

const PROD = 'offlinesms-prod-2027';
const TEST_PKG = 'app.offlinesms.mobile.test';
const staging = process.argv.includes('--staging');

const errors = [];
const fail = msg => errors.push(msg);
const env = name => (process.env[name] ?? '').trim();

const web = {
  apiKey: env('EXPO_PUBLIC_FIREBASE_API_KEY'),
  authDomain: env('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN'),
  projectId: env('EXPO_PUBLIC_FIREBASE_PROJECT_ID'),
  storageBucket: env('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET'),
  appId: env('EXPO_PUBLIC_FIREBASE_APP_ID'),
  messagingSenderId: env('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'),
};
const VAR = {
  apiKey: 'FIREBASE_API_KEY', authDomain: 'FIREBASE_AUTH_DOMAIN', projectId: 'FIREBASE_PROJECT_ID',
  storageBucket: 'FIREBASE_STORAGE_BUCKET', appId: 'FIREBASE_APP_ID', messagingSenderId: 'FIREBASE_MESSAGING_SENDER_ID',
};
for (const [k, v] of Object.entries(web)) if (!v) fail(`web config ${VAR[k]} is missing`);

let gs = null;
try { gs = JSON.parse(process.env.MOBILE_GOOGLE_SERVICES_JSON ?? ''); } catch { fail('google-services.json is missing or not JSON'); }

const project = gs?.project_info?.project_id ?? '';
const number = String(gs?.project_info?.project_number ?? '');
const client = (gs?.client ?? []).find(c => c?.client_info?.android_client_info?.package_name === TEST_PKG);
const androidKey = client?.api_key?.[0]?.current_key ?? '';
if (gs) {
  if (!project || !number) fail('google-services.json has no project_id / project_number');
  if (!client) fail(`google-services.json has no Android client for ${TEST_PKG}`);
  else if (!androidKey) fail(`google-services.json has no API key for ${TEST_PKG}`);
}

if (project && web.projectId && project !== web.projectId) fail('google-services.json belongs to another project than FIREBASE_PROJECT_ID');
if (number && web.messagingSenderId && number !== web.messagingSenderId) fail('FIREBASE_MESSAGING_SENDER_ID is not this project\'s number');
if (web.appId && number && appIdNumber(web.appId) !== number) fail('FIREBASE_APP_ID is not an app of this project');
const androidAppId = client?.client_info?.mobilesdk_app_id ?? '';
if (client && number && appIdNumber(androidAppId) !== number) fail(`the ${TEST_PKG} app id is not an app of this project`);
const bucket = gs?.project_info?.storage_bucket;
if (web.storageBucket && project && (bucket ? web.storageBucket !== bucket : !web.storageBucket.startsWith(`${project}.`))) {
  fail('FIREBASE_STORAGE_BUCKET is not this project\'s bucket');
}
if (staging && (project === PROD || web.projectId === PROD)) fail('staging settings point at the production project');

async function keyProject(label, key) {
  const res = await apiKeyProject(key);
  if (!res.ok) { fail(`${label}: ${res.reason}`); return null; }
  if (!keyBelongsTo(res, project, number)) fail(`${label} belongs to another project`);
  return res;
}

if (!errors.length) {
  const webCfg = await keyProject('web API key (FIREBASE_API_KEY)', web.apiKey);
  await keyProject(`Android API key (${TEST_PKG})`, androidKey);
  if (webCfg && !(webCfg.authorizedDomains ?? []).includes(web.authDomain)) fail('FIREBASE_AUTH_DOMAIN is not an authorized domain of this project');
}

if (errors.length) {
  for (const e of errors) console.error(`backend config: ${e}`);
  process.exit(1);
}
console.log(`backend config: google-services.json, web config and both API keys all belong to ${project}`);
