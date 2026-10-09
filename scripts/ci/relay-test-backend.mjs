// Prepare a private, functional relay APK from the existing project config.
// Never upload google-services.json or silently substitute a fake backend.
import fs from 'node:fs';

const raw = process.env.MOBILE_GOOGLE_SERVICES_JSON;
if (!raw) {
  console.log('Functional relay APK skipped: Firebase build config is absent.');
  process.exit(0);
}
const config = JSON.parse(raw);
const project = config.project_info?.project_id;
if (!project || project !== process.env.MOBILE_TEST_FIREBASE_PROJECT_ID) {
  throw new Error('Relay project must match MOBILE_TEST_FIREBASE_PROJECT_ID');
}
if (project === 'offlinesms-prod-2027' && process.env.MOBILE_TEST_ALLOW_PRODUCTION_BACKEND !== 'true') {
  throw new Error('Production backend requires the existing explicit opt-in');
}
const client = config.client?.find(c => c.client_info?.android_client_info?.package_name === 'app.offlinesms.business');
if (!client?.client_info?.mobilesdk_app_id || !client.api_key?.[0]?.current_key) {
  throw new Error('Firebase config must include Android app app.offlinesms.business');
}
fs.writeFileSync('apps/mobile-relay/app/google-services.json', JSON.stringify({ ...config, client: [client] }));
fs.appendFileSync(process.env.GITHUB_OUTPUT, 'ready=true\n');
console.log(`Private relay APK configured for ${project}.`);
