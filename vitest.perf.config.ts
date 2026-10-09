// Performance harness (not part of `npm test`): real SQLite (sql.js) + the
// app's own repository / sync code, reporting medians and statement counts.
//   npx vitest run --config vitest.perf.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __DEV__: 'false' },
  test: {
    include: ['apps/mobile/__perf__/**/*.perf.ts'],
    environment: 'node',
    testTimeout: 600_000,
    hookTimeout: 600_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
