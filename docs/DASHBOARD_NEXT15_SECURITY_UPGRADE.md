# Dashboard framework security upgrade

Prepared against `7f215c5` on 2026-11-03. This change upgrades the dashboard's
App Router and Server Actions runtime to address
[GHSA-p3m5-59mp-jv5r](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r).
The maintainer identifies Next.js 15.5.28 as the first patched 15.x release and
provides no workaround for affected applications.

## Dependency scope

| Package | Previous dashboard version | Pinned version |
| --- | --- | --- |
| next | 14.2.35 | 15.5.28 |
| eslint-config-next | 14.2.15 | 15.5.28 |
| react / react-dom | 18.2.0 | 19.0.9 |
| @types/react | ^18 | 19.0.14 |
| @types/react-dom | ^18 | 19.0.6 |

The [Next 15 App Router upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-15)
requires React 19. The 19.0 line avoids an additional React minor-version upgrade;
19.0.9 is the patched 19.0 release identified in the
[React Server Components advisory](https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3).
React, React DOM, Next, Lucide and Recharts resolve the same installed React
instance. The root lockfile includes their required framework dependencies.

Mobile remains a standalone installation with its own package manifest and
lockfile. Its runtime dependency versions and the Functions runtime are unchanged.
The release-validation repairs below include an Android manifest/plugin fix and
test-fixture corrections found by the full CI run.

## Application compatibility

- Await all 65 request cookie reads and update four cookie mocks to be async.
- Await the 12 page `params` and 20 `searchParams` properties without changing
  authorization, permissions, queries, defaults, or rendered content.
- Move `typedRoutes` to the stable Next.js configuration property and retain the
  generated Next.js type declarations.
- Retain the supported, deprecated `useFormState` API to avoid unrelated form
  changes. Migrating it to `useActionState` is not required by this update.

All admin routes remain dynamic. Next 15's default client navigation cache no
longer reuses page segments on normal link/router navigation, so navigating may
refresh dashboard data and issue Firestore reads more often. Back/forward and
shared-layout reuse remain. No additional cache policy is introduced.

## Validation

Validated with Node.js 22.13.1 and an isolated clean dependency installation:

```sh
npm ci --ignore-scripts --no-audit --fund=false
npm --workspace apps/dashboard run typecheck
npm --workspace apps/dashboard run lint
npm test -- apps/dashboard/__tests__
npm --workspace apps/dashboard run build
```

All 187 tests in 17 dashboard test files pass. Typecheck, lint and production build
pass. Typecheck also passes without generated `.next` files and with incremental
checking disabled. Production-server checks return 200 for `/login`, redirect
unauthenticated admin requests to login, and reject an unauthenticated user
export with 401. No Firebase credentials or live authenticated data were used.

The installation above skips unrelated workspace lifecycle scripts for local
dashboard validation. The existing DigitalOcean build command remains
`npm ci && npm --prefix apps/dashboard run build`; the run command remains
`npm --prefix apps/dashboard start`.

## Remaining scope and rollout

This is a targeted framework fix, not a full dependency audit remediation.
The dashboard production dependency audit still reports 26 package findings
(10 high, 16 moderate, no critical), including existing Firebase/HTTP-client
dependencies and Next's pinned PostCSS dependency. Advisory counts do not by
themselves establish application exploitability. No broad audit fix, dependency
override, Firebase upgrade, or Next 16 migration is included.

Review and integrate the change through the normal repository release process.
After deploying a reviewed build, verify authenticated sign-in, permissions,
clips administration, settings saves and exports with the intended test account.
Those live workflows have not been exercised by this local validation.

## Release-validation repairs

The first pull-request CI run exposed four blockers. They are corrected without
removing checks or weakening the historical comparison guard:

- Android Back tests now import the navigation library's public exports instead
  of compiling its private legacy TSX implementation. Mobile and workspace
  typechecks and the five existing lifecycle tests pass with the new root types.
- The store-review wire test now seeds a valid group owner and verifies that a
  normal phone login creates a consent invitation without granting membership.
  It continues to prove that review login creates neither a phone link nor an
  invitation. Full wire validation runs in CI; local emulator IPC is restricted.
- The historical APK overlay now includes the two runtime dependencies added by
  earlier releases. All 867 shipped dependency entries and the performance
  instrumentation match the updated app; the existing equality guard is intact.
- Native Android and the Expo plugin combine ML Kit's `subject_segment` and
  `barcode_ui` metadata using an attribute-specific merge override. Regression
  tests check both installed library declarations, native/prebuild parity and
  repeated prebuild behavior. Actual Gradle compilation remains a CI check.

On the assembled repair tree under Node.js 24.22.1, the mobile typecheck and all
1,465 unit tests in 155 files pass locally. Full native builds and the repaired wire test still
require the GitHub Actions rerun.

The production command `node node_modules/next/dist/bin/next start apps/dashboard
-p 3000` uses the verified root entrypoint and port. Local HTTP checks add an
explicit loopback hostname because this execution environment restricts network
interface enumeration; DigitalOcean's existing command does not need changing
based on that local restriction.
