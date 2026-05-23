# Production Smoke-Test Guide

Run this end-to-end guide against the **staging** environment before every production deploy,
and against **production** immediately after deploy.

Use two test accounts: **User A** (the primary tester) and **User B** (a second device or simulator).
Both accounts must be pre-created with verified phone numbers.

---

## Mobile Smoke Tests (17 items)

### M1 — Login & OTP

- [ ] Open the app on a fresh install (or after clearing data).
- [ ] Welcome screen renders correctly.
- [ ] Enter a valid phone number → OTP SMS arrives within 60 s.
- [ ] Enter the correct OTP → proceeds to profile completion (new user) or Chats tab (returning user).

### M2 — Profile completion

- [ ] New user: enter a username → validation accepts valid input, rejects reserved names (`admin`, `support`).
- [ ] Profile completes → lands on Chats tab.

### M3 — Direct chat

- [ ] User A: tap FAB → search for User B's username → open chat.
- [ ] User A: send a text message → User B sees it.
- [ ] User A: observe status ticks: pending → delivered → read (after User B opens the message).

### M4 — Message actions

- [ ] Long-press on a sent message → menu shows: copy, reply, forward, react, star, edit, delete-for-me, delete-for-everyone.
- [ ] Edit a message within the edit window → "edited" badge appears.
- [ ] Delete for everyone → placeholder appears for both users.

### M5 — Group chat

- [ ] User A: create a new group with User B as a member.
- [ ] Send a message → User B sees it.
- [ ] Group info shows both members.
- [ ] User A (as owner): promote User B to admin → User B now appears as admin in the roster.

### M6 — Typing indicator

- [ ] User A starts typing in the chat with User B → User B sees typing indicator.
- [ ] User A stops typing → indicator disappears within 5 s.

### M7 — SMS escalation entry point

- [ ] User A sends a message in a conversation with at least one undelivered recipient.
- [ ] "Send via SMS" option appears in the message actions for User A.
- [ ] Tap → SMS escalation sheet opens showing eligible recipient count and points cost.
- [ ] Eligible recipients do not include opt-out users or users without verified phone.
- [ ] Points cost matches `eligible × costPerSms`.

### M8 — SMS escalation — insufficient balance

- [ ] If User A's balance is below the required points: "Send via SMS" is blocked with a clear message.
- [ ] No raw phone numbers visible anywhere in the SMS escalation UI.
- [ ] No provider names visible anywhere in the SMS escalation UI.

### M9 — SMS escalation — send and receipt

- [ ] Fund User A's wallet with enough points for at least one SMS batch (use admin panel or test purchase webhook).
- [ ] Initiate SMS escalation → confirm → batch report opens.
- [ ] Batch report shows per-recipient status with **masked** phones (not raw numbers).
- [ ] Retry failed: button only appears when at least one recipient has status `failed` or `undelivered`.

### M10 — Points wallet

- [ ] Navigate to Wallet → balance / reserved / available shown correctly.
- [ ] Tap "Buy points" → BuyPoints flow opens with package list.
- [ ] Tap "Transfer" → TransferPoints flow opens.
- [ ] Transfer to self → blocked with error.
- [ ] Transfer to a non-existent username → blocked with error.

### M11 — Transaction history

- [ ] Transaction history lists recent entries.
- [ ] Filter chips work: all / SMS / refunds / purchases / transfers / admin.
- [ ] Each entry shows the correct icon and formatted amount (`+N pts` or `−N pts`).

### M12 — Support ticket

- [ ] Navigate to Help & Support → Support Ticket form.
- [ ] Submit with empty subject → blocked.
- [ ] Submit with empty details → blocked.
- [ ] Submit valid form → "My tickets" tab shows the new ticket with status "open".

### M13 — Settings — i18n

- [ ] Switch language to Arabic → restart app → entire UI renders in Arabic with RTL layout.
- [ ] Switch back to English → restart → EN layout restored.

### M14 — Settings — dark mode

- [ ] Switch theme to Dark → observe immediate UI swap.
- [ ] Switch to Light → observe immediate UI swap.
- [ ] Switch to System → observe theme follows device setting.

### M15 — Settings — toggles persist

- [ ] Toggle "SMS reminders" → close and reopen app → toggle state preserved.
- [ ] Toggle "In-app notifications" → close and reopen app → toggle state preserved.

### M16 — Receipts

- [ ] Open message info (long-press → Info, sender only) → per-recipient receipt list with timestamps.
- [ ] User B tries to open message info on a message sent by User A → "Sender only" copy shown.

### M17 — Sign out

- [ ] Settings → Sign out → returns to Welcome screen.
- [ ] Re-entering the app shows Welcome, not the Chats tab.

---

## Dashboard Smoke Tests (13 items)

### D1 — Auth gate

- [ ] Navigate to `/admin` while signed out → redirected to `/login`.
- [ ] Sign in with a non-admin account → "Admin access required" page shown.

### D2 — Role-based navigation

- [ ] Sign in as `super_admin` → full nav visible.
- [ ] Sign in as `support_agent` → only Support, Users (read), Audit visible.
- [ ] Sign in as `auditor` → only Audit visible; no manage actions.

### D3 — Org scoping

- [ ] Sign in as `organization_admin` with a specific `organizationId` claim.
- [ ] Users list shows only users in that org.
- [ ] Attempt to navigate to a user from another org by URL → not found / forbidden.

### D4 — Search

- [ ] Press Cmd/Ctrl-K → search overlay opens.
- [ ] Type one character → "Type at least 2 characters" shown.
- [ ] Type a valid username → results render (users, groups, batches sections).
- [ ] Phone numbers in results are masked.

### D5 — Export

- [ ] Export users CSV → download starts within 3 s; phones and emails are masked.
- [ ] Export SMS CSV → download starts within 3 s.
- [ ] Export audit CSV → download starts within 3 s.

### D6 — Privileged action + audit log

- [ ] Perform a role change (e.g., set `support_agent` to `auditor` and back).
- [ ] Navigate to Audit log → entry for this action appears within 5 s.
- [ ] Audit entry contains no message bodies, no full phone numbers, no secrets.

### D7 — Wallet management

- [ ] Navigate to a user's wallet detail.
- [ ] Balance and reserved values shown correctly.
- [ ] Wallet status change (e.g., freeze) does not alter the balance.

### D8 — SMS batch view

- [ ] Navigate to SMS page → batch list loads.
- [ ] Open a batch → per-recipient status shown with masked phones.
- [ ] No raw phone numbers visible anywhere.
- [ ] No provider names visible anywhere.

### D9 — Support ticket management

- [ ] Navigate to Support → ticket list shows the ticket created in M12.
- [ ] Update ticket status → mobile app ticket list reflects the change within seconds.

### D10 — Notification draft

- [ ] Navigate to Notifications → draft a broadcast message.
- [ ] "Send broadcast" button is disabled and labeled as such (not functional in production).

### D11 — Rate limits — search

- [ ] Send 61 search requests in under 60 s → 61st request returns 429 / rate-limit copy.

### D12 — Rate limits — export

- [ ] Attempt 11 exports in under 60 min → 11th request returns 429 / rate-limit copy.

### D13 — Reports

- [ ] Navigate to Reports → overview loads within 2 s.
- [ ] Switch date ranges → charts update with the selected range.

---

## Security Negative Tests (6 items)

### S1 — Wallet client write denied

- [ ] Sign in as a test user in the Firebase console → attempt to write `wallets/{uid}/balance = 9999` directly → denied by Firestore rules.

### S2 — Payment status client write denied

- [ ] Attempt to write `payments/{id}/status = 'completed'` directly → denied.

### S3 — Audit log client write denied

- [ ] Attempt to add a document to `auditLogs` collection directly → denied.

### S4 — Cross-user message read denied

- [ ] As User A, attempt to read a message in a conversation User A is not part of → denied.

### S5 — SMS batch cross-user read denied

- [ ] As User A, attempt to read a batch document where `senderId = userB` → denied.

### S6 — Rate limit bypass

- [ ] Send 100 search requests in 10 s → 429 returned after request 60.

---

## Pass Criteria

All 36 items (M1–M17, D1–D13, S1–S6) must pass with no regressions before
enabling end-user access in production.

Document any failures with screenshots and create a release-blocker issue.
Do not proceed with go-live until all release-blockers are resolved.
