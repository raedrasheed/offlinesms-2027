// Wire-level callable tests (see scripts/ci/runCallableTests.sh): requests go
// over HTTP to the Functions emulator, so firebase-functions' own ID-token
// verification, payload parsing and error serialization are exercised.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['functions/__callable__/**/*.callable.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { maxForks: 1, minForks: 1 } },
    env: {
      GCLOUD_PROJECT: 'demo-offlinesms',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    },
  },
});
