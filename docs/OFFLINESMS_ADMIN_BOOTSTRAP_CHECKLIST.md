# Admin Bootstrap Checklist

Use this guide for the very first deployment (no admin accounts exist yet)
and whenever you need to verify admin account integrity.

---

## First-Time Bootstrap

### Step 1 — Create the first super_admin account

The `promote:admin` callable function is the only way to elevate a user to `super_admin`.
On the first deploy it must be called from a trusted server context (not the mobile app or dashboard,
as neither has admin access yet).

```bash
# From a Firebase Admin SDK script or via the Firebase console → Functions → Shell

# Option A — Firebase Functions shell
firebase functions:shell
# Then:
promoteAdmin({ uid: '<uid-of-first-user>', role: 'super_admin' })
```

```typescript
// Option B — Node script (run once, do not commit secrets)
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Use a downloaded service-account key — do not commit this file
const app = initializeApp({ credential: cert('./service-account.json') });
const db = getFirestore(app);

await db.collection('users').doc('<uid>').update({
  role: 'super_admin',
  roleSetAt: new Date().toISOString(),
  roleSetBy: 'bootstrap',
});
```

> The `uid` must belong to an already-authenticated user (they must have signed in at least once
> so the Firestore user document exists).

### Step 2 — Verify the super_admin account

- [ ] Sign in to the dashboard as the bootstrapped account.
- [ ] Full navigation is visible (Users, Groups, SMS, Points, Support, Audit, Reports, Settings).
- [ ] Open Settings → Role shows `super_admin`.
- [ ] Audit log shows a role-change entry for the bootstrap action.

### Step 3 — Protect last super_admin

- [ ] Attempt to demote the only `super_admin` via the dashboard → should be blocked with error.
- [ ] Log shows "Cannot demote the last super_admin" (or equivalent copy) — not a raw error.

### Step 4 — Create a support_agent account (optional but recommended for smoke testing)

- [ ] Create a second user account (sign in via mobile or directly via Firebase Auth).
- [ ] From the super_admin dashboard, navigate to Users → select the user → Set role → `support_agent`.
- [ ] Sign in as `support_agent`: confirm restricted nav (Support, Users read-only, Audit).
- [ ] Confirm `support_agent` cannot access Users → manage actions (Set role button absent or disabled).
- [ ] Audit log shows a role-change entry for this action.

---

## Ongoing Bootstrap Integrity Checks

Run these after every deployment that touches admin permissions code:

- [ ] `super_admin` can access all dashboard routes.
- [ ] `support_agent` cannot access `/admin/reports`, `/admin/notifications`, `/admin/sms`.
- [ ] `auditor` can view Audit page and export audit CSV; cannot perform manage actions.
- [ ] `organization_admin` with `organizationId` claim sees only their org's users and groups.
- [ ] Non-admin user account hitting `/admin` is redirected to "Admin access required" page.
- [ ] Unauthenticated request to `/admin` redirects to `/login`.

---

## Route Guard Verification

The dashboard route guard relies on the `role` field in the Firestore `users/{uid}` document
and the Firebase Auth custom claims set by the `syncRoleClaims` function.

If a role update is not reflected in the dashboard immediately:
1. The user may need to sign out and sign back in (custom claims are cached in the ID token for up to 1 hour).
2. Verify `syncRoleClaims` completed without error in Cloud Logging.

---

## Emergency: Restoring a Locked-Out Super Admin

If all `super_admin` accounts are lost or locked out:

1. Use the Firebase Admin SDK (service-account key, server-side only) to restore the `role` field directly:
   ```typescript
   await db.collection('users').doc('<uid>').update({ role: 'super_admin' });
   ```
2. Force-refresh the user's ID token by having them sign out and back in.
3. Document the action — add a manual entry to the audit log collection via Admin SDK.

> Service-account keys must never be committed. Store them in a secure vault (e.g., Google Secret Manager or 1Password).
