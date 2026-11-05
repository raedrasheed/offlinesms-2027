# Group image and video upload repair — 2026-11-05

Group media uploads evaluated three distinct Firestore documents in Storage rules: the conversation, the sender's membership, and the reserved message. Production Storage rules allow at most two documents per evaluation. Direct conversations already used two. The new rules use the conversation and message, preserving upload ownership, reserved path/MIME/size, pending status, deletion and retention checks.

Reference: [Firebase Storage rules: Enhance with Cloud Firestore](https://firebase.google.com/docs/storage/security/rules-conditions#enhance_with_cloud_firestore).

## Membership safety

A group must have the server-owned `mediaAclVersion: 2` before its canonical participant list can authorize media. New groups receive the marker when created with the owner's active membership. Existing groups receive it only through the reconciliation script below. Unmarked groups fail closed.

`removeMember` and `leaveGroup` now update membership and both participant arrays in a transaction. Concurrent removals or departures cannot restore a departed UID from a stale roster. Other enrollment paths already transact consented membership and the roster. Firestore rules reject client-supplied media ACL markers on conversation creation.

The reconciler uses `participantUids` when present, otherwise `memberIds`, and only removes entries whose member document is missing or inactive. It never expands membership from a stale fallback array or from extra member documents. It synchronizes both arrays and memberCount, then stamps the marker in the same transaction. Every group, including previously marked groups, is checked. Malformed groups are reported without changing their arrays. In apply mode, an existing ACL marker is revoked for a malformed group so it cannot bypass reconciliation; invalid data still produces a nonzero exit.

## Production rollout

No mobile build is required. These commands must run from the updated repository with production Firebase access. The coding session does not deploy production or possess its credentials. Complete each stage successfully before continuing; the order protects the new ACL invariant.

### 1. Update the checkout and protect the marker

```powershell
Set-Location D:\sms-production
git switch main
git pull --ff-only
npm ci
firebase deploy --project offlinesms-prod-2027 --only "firestore:rules"
```

Deploy the Firestore guard before scanning groups. Otherwise a client could insert a forged marker after a scan and before the new Storage rules activate.

### 2. Deploy the group membership writers

```powershell
npm --workspace functions run build
firebase deploy --project offlinesms-prod-2027 --only "functions:createGroup,functions:removeMember,functions:leaveGroup"
```

Wait for all three Functions to deploy successfully before reconciliation. Do not revert these membership writers while the new Storage rules are active.

### 3. Review existing group access

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "D:\offlinesms-prod-2027-admin.json"
npx tsx scripts/reconcileGroupMediaAccess.ts --project=offlinesms-prod-2027
```

The default is a dry run with no writes. Review reported group IDs, removal counts, invalid data and errors. The credential file stays on the operator's machine. Resolve unexpected removals or invalid groups before proceeding.

### 4. Reconcile and verify

```powershell
npx tsx scripts/reconcileGroupMediaAccess.ts --project=offlinesms-prod-2027 --apply
npx tsx scripts/reconcileGroupMediaAccess.ts --project=offlinesms-prod-2027
```

The second run should report no remaining changes or failures for groups that existed during the first scan. Newly created groups are already correctly marked by the deployed callable. The script rechecks current data inside transactions, so membership changes during the run cannot be overwritten from its earlier scan.

### 5. Activate Storage access

```powershell
firebase deploy --project offlinesms-prod-2027 --only "storage"
```

Do not activate Storage rules after a partial or failed prerequisite rollout. If rollback is necessary, restore the previous Storage rules first; groups may again be unable to upload, but the older membership functions must not coexist with list-only media authorization.

## Verification

Automated coverage targets the two-document rule budget, JPEG/PNG/MP4 uploads through authenticated Storage REST requests, pending/finalized media reads, wrong sender/path/size/MIME, removed/left members, deleted parent conversations, forged ACL markers, concurrent membership changes, and conservative reconciliation. See the pull request's CI results for the checks actually completed.

After deployment, use two real accounts to send a new image and video in an existing group and a newly created group; confirm delivery, playback, and display after reopening. Confirm a direct-chat attachment still works. Remove or leave with a test member and verify new authenticated access is denied. Previously issued download URLs or already downloaded copies are not retroactively revoked by Storage rules.

Old blank attachments may represent uploads that never reached Storage. Retry from the original sender if the local file and retry action remain available; otherwise resend the image/video. The repair cannot recreate file bytes that were never uploaded.

The installed firebase-tools 13.35.1 emulator drops the HTTP Content-Type header on raw media uploads, defaulting to application/octet-stream. The integration test therefore sends authenticated REST multipart uploads with explicit MIME metadata and the unchanged production rules. It verifies authorization, stored bytes and create/finalize handlers; it does not claim byte-identical native uploader coverage. The production mobile uploader is unchanged and still requires the device check above. See [the affected emulator implementation](https://github.com/firebase/firebase-tools/blob/v13.35.1/src/emulator/storage/apis/firebase.ts).
