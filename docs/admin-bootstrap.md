# Admin bootstrap

This guide covers promoting the **first** OfflineSMS admin. Long-term role management belongs to the dashboard's Roles module (Phase 18); the script described here is only for getting that first admin into the system.

---

## Prerequisites

- A Firebase project with at least one signed-in user (e.g. through the mobile phone-OTP flow, or seeded via `npm run seed`).
- A service account key with the `Firebase Authentication Admin` IAM role.
- Node 22 + the repo installed (`npm install` at the root).

The service account is **only** used locally by this script and by the dashboard's server runtime. It should never be checked into the repository.

---

## Bootstrap path: the `BOOTSTRAP_ADMIN_EMAILS` env var

Phase 1 added a temporary escape hatch in the dashboard guard. Until any user carries an admin claim in Firebase Auth, an email in the `BOOTSTRAP_ADMIN_EMAILS` allow-list can reach `/admin`. Once a real admin exists, remove the env var.

`apps/dashboard/.env.local`:

```
BOOTSTRAP_ADMIN_EMAILS=you@example.com
```

This is the *minimum* path to reach the admin UI on day one — it does not grant admin claims, just temporary access. Run the promotion script to make it permanent.

---

## Promote a user with `npm run promote:admin`

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
npm run promote:admin -- you@example.com
```

What the script does:

1. Loads service-account credentials from `GOOGLE_APPLICATION_CREDENTIALS` (or Application Default Credentials when running inside Google environments).
2. Looks up the user by email.
3. Sets two **custom claims** (preserving any others):
   - `admin: true` — gates the Phase 1 guard.
   - `role: 'super_admin'` — matches the forward-compatible role list (`super_admin`, `organization_admin`, `support_agent`, `finance_admin`, `auditor`).
4. Prints the user's `uid` and the new claim payload.

The script refuses to run without an email argument and refuses unknown emails. It never prints the service-account file or its contents.

After promotion, the user must **sign out and back in** for the new claim to be picked up (Firebase ID tokens cache the claim block until refresh).

---

## Verifying

1. Sign in to the dashboard as the promoted email.
2. Hit `/admin`. The guard's `verifySession()` should now match on `admin: true` (or the forward-compat `role: super_admin`) and render the admin shell.
3. Inspect the user's claims with `firebase auth:export` or via the Admin SDK if you want to confirm.

---

## Removing the bootstrap env var

Once at least one user is promoted via the script, edit your dashboard environment to remove `BOOTSTRAP_ADMIN_EMAILS`. The guard prefers admin claims; the env var is only consulted when no admin claim is present anywhere.

---

## Rotating or revoking

To revoke admin from a user, set their custom claim back to `{ admin: false, role: 'member' }` (or whatever is appropriate when Phase 18 lands). A small `revokeAdmin.ts` script is a planned Phase 18 deliverable.

To rotate the service-account key:

1. Create a new key in the Google Cloud console.
2. Update `GOOGLE_APPLICATION_CREDENTIALS` everywhere it's referenced (CI secret, dashboard runtime env, local shells).
3. Disable the old key.

---

## Security notes

- This script is intended for **one-time** bootstrap. Don't bake it into automation.
- Do not paste service-account JSON into chat tools, screenshots, or PRs.
- The script does not touch Firestore. It only mutates custom claims via the Auth API.
- If you need to seed demo users with admin claims for a dev environment, do that explicitly via this script per user — never auto-promote on signup.
