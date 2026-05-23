# OfflineSMS Phase 2 Plan

**Branch:** `claude/repo-audit-architecture-MiZDX`
**Prereqs:** Phase 1 complete (commits through `bdd4271`).

---

## Objective

Land authentication and onboarding foundations: a native phone OTP path, a profile-completion flow with uniqueness-checked usernames, hardened Firestore rules for `users`, and a documented first-admin bootstrap script. No chat, SMS, points, or dashboard product features.

---

## Scope

### 4.1 Native phone OTP

- Keep web reCAPTCHA path unchanged.
- Add a documented native path using `expo-firebase-recaptcha` (already in the Expo ecosystem and works with managed Expo without ejecting). Falls back to a clearly-labelled "native OTP not configured" error if the FirebaseRecaptchaVerifierModal is not mounted, so emulator + web users still work end-to-end.
- Map known Firebase Auth error codes to user-friendly strings (`invalid-phone-number`, `code-expired`, `invalid-verification-code`, `too-many-requests`, `network-request-failed`, `quota-exceeded`).
- Add a `cancelOtp()` helper that clears in-flight verification state.
- **No OTP value is ever stored in Firestore or logged.** The `ConfirmationResult` lives in module-scope only.

### 4.2 Profile completion

- New screen `apps/mobile/src/screens/ProfileCompletion.tsx`:
  - Fields: `displayName` (required), `username` (required), `about` (optional). Avatar upload deferred to a later phase; profile keeps `photoURL` as `null` for now.
  - Validation: display name 1–60 chars; username 3–20 chars, `[a-z0-9_.]`, dot/underscore not at edges or consecutive, lowercased before submit; reserved list checked client-side too.
  - Calls the `claimUsername` callable; on success writes the rest of the profile via direct `users/{uid}` update (within field allow-list).
- `App.tsx` routes a signed-in user to `ProfileCompletion` until `users/{uid}.profileCompleted === true`.
- The screen reads/writes only fields the rules allow.

### 4.3 Username uniqueness

- New Firestore collection `usernames/{lowercaseUsername}` with fields `uid`, `username`, `claimedAt`.
- New callable `functions/src/auth/claimUsername.ts`:
  - Normalises to lowercase.
  - Validates format and rejects reserved usernames.
  - Runs in a Firestore transaction:
    - If `usernames/{lower}` exists and `uid !== caller`, reject with `already-exists`.
    - Otherwise write the username doc and update `users/{uid}` with `displayName`, `username`, `usernameLower`, `about`, `profileCompleted=true`, `updatedAt`, releasing any prior `usernameLower` the caller held.
- Username changes are supported via the same callable (releases old `usernames/{old}` and claims `{new}` in one transaction).

### 4.4 Firestore rules hardening

- Add helpers: `isSignedIn()`, `onlyAllowedUserUpdates()`.
- Tighten `users.update` to a field allow-list (`displayName`, `username`, `usernameLower`, `photoURL`, `about`, `profileCompleted`, `updatedAt`, `fcmTokens`, `lastSeen`).
- Deny client mutations of `role`, `roles`, `permissions`, `admin`, `isAdmin`, `points`, `pointsBalance`, `wallet`, `walletStatus`, `organizationId`, `createdAt`, `phoneVerified`, `status`.
- Restrict `users.create` to a tighter allow-list and prevent self-bootstrapping into admin (`role`, `admin` fields stripped at create time).
- `usernames/{lower}`: read by anyone authed (for sign-in UX later); writes server-only (via `claimUsername` callable). Even with rules read-allowed, the document carries no sensitive data — `{uid, username, claimedAt}`.

### 4.5 Admin bootstrap script

- `scripts/promoteAdmin.ts`:
  - Reads target email from `argv[2]`.
  - Uses Firebase Admin SDK via `GOOGLE_APPLICATION_CREDENTIALS` (or the existing dashboard service-account env vars).
  - Looks up user by email, refuses if not found.
  - Sets `admin: true` custom claim **plus** `role: 'super_admin'` so the new RBAC roles work too.
  - Prints `uid` and current claims; **never prints the service-account key**.
  - Refuses to run if no email is provided.
- `npm run promote:admin -- email@example.com` added to root `package.json`.
- Doc: `docs/admin-bootstrap.md`.

### 4.6 Optional email-link sign-in

- Current state: no scaffolding — `/login` uses email+password and Google, mobile auth is phone-only. Implementing email-link from scratch is out of scope; **deferred** with a documentation entry.

### 4.7 Documentation updates

- `docs/OFFLINESMS_PHASE_LOG.md` — Phase 2 entry.
- `docs/OFFLINESMS_TECHNICAL_ARCHITECTURE.md` — usernames collection, claimUsername callable, rule helpers.
- `docs/OFFLINESMS_RISK_REGISTER.md` — record mitigations.
- `docs/OFFLINESMS_DESIGN_IMPLEMENTATION_MAP.md` — bump module #1, #2 statuses.
- `docs/admin-bootstrap.md` — new.

---

## Files expected to change

**Create**
- `docs/OFFLINESMS_PHASE_2_PLAN.md` (this file)
- `docs/admin-bootstrap.md`
- `apps/mobile/src/screens/ProfileCompletion.tsx`
- `apps/mobile/src/lib/profile.ts` (callable wrapper + types)
- `apps/mobile/src/lib/username.ts` (validation + reserved list)
- `functions/src/auth/claimUsername.ts`
- `scripts/promoteAdmin.ts`

**Edit**
- `apps/mobile/src/lib/auth.ts` — native path, error mapping, cancel helper.
- `apps/mobile/src/lib/firebase.ts` — export `getRecaptchaConfig()` if helper required.
- `apps/mobile/src/screens/PhoneEntry.tsx` — mount native recaptcha, friendlier errors.
- `apps/mobile/src/screens/Otp.tsx` — friendlier errors, resend.
- `apps/mobile/App.tsx` — gate root stack on `profileCompleted`.
- `apps/mobile/src/i18n/{en,ar}.json` — new strings for profile completion + errors.
- `functions/src/index.ts` — export `claimUsername`.
- `functions/src/auth/onUserCreate.ts` — seed `profileCompleted: false`, `usernameLower: null`.
- `firestore.rules` — field allow-list + `usernames` rules.
- `firestore.indexes.json` — none needed (lookup by doc id).
- `package.json` (root) — `promote:admin` script.
- Docs as listed above.

---

## Auth flow design

```
[ Welcome ]
    │
    ▼
[ PhoneEntry ] ── sendOtp(phone) ─────────────► Firebase Auth
    │                                                  │
    ▼                                                  ▼
[ Otp ] ────── verifyOtp(code) ────────► onAuthStateChanged fires
    │                                                  │
    ▼                                                  ▼
                                          users/{uid} exists (server trigger)
                                              ?  profileCompleted ?
                                              │
                                ┌─────────────┴─────────────┐
                                ▼                           ▼
                       [ ProfileCompletion ]            [ MainTabs ]
                                │
                                ▼
                  callable: claimUsername
                       │
                       ├─ tx: usernames/{lower}
                       └─ tx: users/{uid}.update
                                │
                                ▼
                            [ MainTabs ]
```

States surfaced in UI:
- `idle` / `sending` / `awaiting code` / `verifying` / `verified` / `claiming username` / `done`
- Errors: invalid phone, invalid code, code expired, too many attempts, network error, recaptcha failed, username taken, username reserved, username invalid format.

---

## Firestore changes

- New `usernames/{lower}` collection.
- `users/{uid}` gains `username`, `usernameLower`, `about`, `profileCompleted`.
- No indexes needed: all lookups are by doc id.

---

## Security rules changes

- Field allow-list for `users.update` and `users.create` (deny role/admin/wallet/security fields).
- `usernames/*`: client-read allowed (for "is this username taken?" reads), all writes server-only.
- Existing collections untouched.

---

## Cloud Functions changes

- New callable: `claimUsername` (Gen 2 `onCall`). Validates, transacts on `usernames/{lower}` and `users/{uid}`. Releases prior username if caller is renaming.
- `onUserCreate` trigger seeds `profileCompleted: false` so the rule field-allow-list covers it from day one.

---

## Test plan

The repo has no test harness yet (Phase 20). Phase 2 follows manual validation:

- `npm run typecheck --workspaces --if-present` — must be green.
- `npm run lint --workspaces --if-present` — must be green.
- `npm run build --workspaces --if-present` — must be green.
- **Manual** (Firebase emulator):
  1. Sign in via phone OTP on web; ensure the user is routed to ProfileCompletion.
  2. Claim a username; verify `usernames/{lower}` and `users/{uid}` writes.
  3. Try claiming the same username from a second account → rejected with `already-exists`.
  4. Try a reserved username (`admin`, `support`) → rejected.
  5. Try directly writing `users/{uid}.role = 'admin'` from the client → denied by rules.
  6. Run `npm run promote:admin -- admin@example.com` against the emulator → claim set, output prints `uid` and claims.
  7. Existing admin guard still works.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Tightened `users.update` allow-list breaks Phase 1 code that writes other fields | Low | Medium | Audit existing writes (only `onUserCreate` trigger and the new ProfileCompletion screen). All other client writes go through callables. |
| Native OTP modal not present in Expo runtime → throws at runtime | Medium | Low | Catch and surface "Phone verification isn't configured in this build" cleanly; web path remains functional for development. |
| Username squatting via fast-fire callable | Medium | Low | Callable is rate-limited per-uid by Firebase's per-instance quota; full rate-limiting is a later phase. Reserved list blocks obvious abuse. |
| Rules update accidentally locks legitimate writers out | Medium | High | Keep `isAdmin()` escape hatch; add granular rules unit tests in Phase 20; staging deploy + smoke test before prod. |
| First-admin script run with wrong email | Low | High | Script requires explicit email argument; prints `uid` for confirmation; refuses unknown emails. |

---

## Rollback plan

- All changes live on `claude/repo-audit-architecture-MiZDX`; no production deploys.
- Each commit is scoped to one concern; `git revert <hash>` undoes one piece at a time.
- Rules change is the highest-risk piece — kept in its own commit so revert is one shot.
- The ProfileCompletion gate in `App.tsx` is guarded by `profileCompleted`; setting that field to `true` for affected users in Firestore is the manual rollback fallback.

---

## Acceptance criteria

1. Phone OTP works on web (existing) and is documented + non-blocking on native.
2. ProfileCompletion screen exists, gates the main app, validates inputs.
3. `claimUsername` callable transactionally enforces uniqueness, including renames.
4. Reserved usernames blocked client-side **and** server-side.
5. `firestore.rules` for `users` enforce a field allow-list; sensitive fields can't be set by clients.
6. `usernames` collection rules ship; client-write denied.
7. `scripts/promoteAdmin.ts` exists, runs only when invoked, has a doc.
8. No chat / SMS / points / dashboard feature work.
9. No third-party SMS provider names introduced.
10. Phase 1 admin guard still works.
11. `typecheck`, `lint`, `build` all green.
12. Phase log updated.

---

## Commit plan

1. `docs: add OfflineSMS phase 2 implementation plan`
2. `feat(auth): add native phone OTP flow with friendly errors`
3. `feat(profile): add profile completion screen with username validation`
4. `feat(functions): add claimUsername callable`
5. `security: harden user profile Firestore updates`
6. `chore(admin): add first-admin promotion script`
7. `docs: update phase log for phase 2`
