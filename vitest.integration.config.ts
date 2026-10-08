// Emulator-backed adversarial tests for the SMS-abuse / phone-linking work.
//
// These call the REAL callable handlers (and the relay claim/report/reaper
// functions) against the Firestore + Auth emulators. No SMS is ever sent: a
// "delivered" code is read back from the queued relayJobs document, exactly
// as a relay phone would receive it. No real phone numbers are contacted.
//
//   npm run test:integration
//     (= firebase emulators:exec --only firestore,auth "vitest run -c vitest.integration.config.ts")

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['functions/__integration__/**/*.int.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { maxForks: 1, minForks: 1 } },
    fileParallelism: false,
    env: {
      GCLOUD_PROJECT: 'demo-offlinesms',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      // Test-only values; production reads the secret from Secret Manager.
      PHONE_HASH_PEPPER: 'integration-test-pepper-0123456789abcdef0123456789',
      PHONE_LINK_ENABLED: 'true',
      PHONE_AUTH_ENABLED: 'true',
      EMAIL_PROVIDER: 'console',
    },
    reporters: ['default'],
  },
});
