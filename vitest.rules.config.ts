// Firestore rules tests — require a running Firestore emulator.
//
// Usage:
//   1. Terminal A: firebase emulators:start --only firestore
//   2. Terminal B: npm run test:rules
//
// The rules tests use @firebase/rules-unit-testing to load
// `firestore.rules` against the emulator's projectId and drive
// allow/deny assertions through authenticated and unauthenticated
// contexts.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/rules/**/*.rules.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 1,
        minForks: 1,
      },
    },
    reporters: ['default'],
  },
});
