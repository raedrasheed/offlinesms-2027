// Root vitest config — utility tests and mobile components with native host mocks.
//
// Rules tests under `tests/rules/` require the Firestore emulator and
// are NOT in this config. Use `npm run test:rules` to run them after
// starting `firebase emulators:start --only firestore`.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Match Expo's JSX transform when mounting a mobile component in a unit test.
  esbuild: { jsx: 'automatic' },
  test: {
    include: [
      'apps/dashboard/__tests__/**/*.test.ts',
      'apps/mobile/__tests__/**/*.test.ts',
      'functions/__tests__/**/*.test.ts',
    ],
    exclude: [
      'node_modules/**',
      '**/dist/**',
      'tests/rules/**',
    ],
    environment: 'node',
    globals: false,
    reporters: ['default'],
  },
});
