# OfflineSMS Manual QA Checklist

Use this end-to-end matrix before every release. Each section is a self-contained gate.

---

## A. Mobile — Auth & profile

- [ ] Welcome screen renders correctly in EN and AR
- [ ] Phone entry validates international format
- [ ] OTP delivered within 60 s; resend works after timer
- [ ] Wrong OTP shows the correct error copy (not the raw provider error)
- [ ] First-time user → profile completion flow
- [ ] Username validation rejects: too-short, too-long, invalid chars, edge punctuation, consecutive punctuation, reserved names (`admin`, `support`, etc.)
- [ ] Profile completes; lands on Chats tab
- [ ] Sign out from Settings returns to Welcome

## B. Mobile — Direct chat

- [ ] New chat from FAB
- [ ] Search for username, start direct chat
- [ ] Send text → recipient sees it; sender sees status pending → delivered → read
- [ ] Long-press menu: copy, reply, forward, react, star, edit (own message within window), delete-for-me / delete-for-everyone
- [ ] Edited messages show "edited" badge
- [ ] Deleted messages show the placeholder
- [ ] Typing indicator appears for the other side and disappears within 5 s of stopping
- [ ] Pinned message banner appears; tap to jump

## C. Mobile — Groups

- [ ] Create new group from FAB
- [ ] Add at least 3 members
- [ ] Send a text; all members see it
- [ ] Group info shows roster
- [ ] Admin can promote / demote member
- [ ] Admin can remove member; removed member can no longer read/send
- [ ] Owner can lock group; non-admin send is blocked with copy
- [ ] Leave group works; transfer-ownership prompt shows for owner
- [ ] Group member count never exceeds 1024 (server enforced)

## D. Mobile — Receipts

- [ ] Single-tick: pending
- [ ] Double-tick gray: delivered
- [ ] Double-tick colored: read
- [ ] Message info screen (sender only) shows per-recipient receipt list
- [ ] Non-sender attempting to view message info gets the "sender only" copy

## E. Mobile — SMS escalation

- [ ] SMS escalation entry point appears for sender of messages with undelivered recipients
- [ ] Preview correctly excludes:
  - opt-out users
  - users without phone
  - users with unverified phone
  - duplicate phones (keep first)
  - users who already received SMS for this exact message
- [ ] Points cost matches `eligible × costPerSms`
- [ ] Insufficient balance blocks send
- [ ] Cool-down active blocks send with a clear message
- [ ] Audience cap enforced (cannot exceed `MAX_RECIPIENTS_PER_BATCH`)
- [ ] After send: batch report shows per-recipient status with masked phones
- [ ] Retry failed only retries recipients whose status ∈ {failed, undelivered}
- [ ] No provider names anywhere in the UI
- [ ] No raw phone numbers anywhere in the UI

## F. Mobile — Points

- [ ] Wallet shows balance / reserved / available
- [ ] "Buy points" navigates to BuyPoints flow
- [ ] BuyPoints lists packages with localized prices (mock/dev)
- [ ] Webhook callback (dev) credits wallet and adds transaction
- [ ] Duplicate webhook does NOT double-credit (verify via transaction count)
- [ ] "Transfer" navigates to TransferPoints
- [ ] Transfer to self is blocked
- [ ] Transfer to non-existent user is blocked
- [ ] Transfer to frozen wallet is blocked with copy
- [ ] Daily cap on transfers is enforced
- [ ] Transaction history filter chips work: all / SMS / refunds / purchases / transfers / admin

## G. Mobile — Support ticket

- [ ] Form: category chips, subject (required), details (required)
- [ ] Empty subject blocks submission
- [ ] Empty details blocks submission
- [ ] Submission succeeds; tab switches to "My tickets"
- [ ] My tickets list shows the new ticket with status "open"
- [ ] After admin updates status, the user-side list reflects the change within seconds

## H. Mobile — Settings / i18n / RTL / dark mode

- [ ] Settings: points wallet card shows balance + reserved
- [ ] SMS reminders toggle persists
- [ ] In-app notifications toggle persists
- [ ] Language: switch EN → AR; restart app; whole UI is in AR with RTL layout
- [ ] Theme: switch System → Dark → Light; observe immediate UI swap
- [ ] Time format: switch 12h → 24h; observe formatted timestamps change
- [ ] Privacy navigates to Privacy screen
- [ ] Linked devices navigates to Devices screen
- [ ] Help & Support navigates to SupportTicket screen

## I. Mobile — Accessibility

- [ ] VoiceOver / TalkBack reads every button with a meaningful label
- [ ] Decorative emoji in chat are not announced
- [ ] Switch controls announce their state ("on" / "off")
- [ ] Selected chips announce as "selected"
- [ ] Tab order follows visual reading order

## J. Dashboard — Auth & sessions

- [ ] `/admin` while signed out → redirects to `/login`
- [ ] Sign in as a non-admin account → `Admin access required` page
- [ ] Sign in as `super_admin` → full nav visible
- [ ] Sign in as `support_agent` → only Support, Users (read), Audit visible
- [ ] Sign in as `auditor` → only Audit, exports, search visible (no manage actions)

## K. Dashboard — Search & export

- [ ] Cmd/Ctrl-K opens search overlay
- [ ] Type `< 2` chars: shows "Type at least 2 characters"
- [ ] Type valid query: results render in groups (users, groups, batches)
- [ ] Phones in results are masked
- [ ] After 60 search requests within a minute: 429 / rate limit copy
- [ ] Export each surface: users, groups, sms, points, support, audit
- [ ] All CSVs have masked phones and emails
- [ ] After 10 exports within an hour: 429 / rate limit copy
- [ ] After 5 audit exports within an hour: 429 / rate limit copy

## L. Dashboard — Privileged actions

- [ ] Admin set role: cannot demote the last super_admin
- [ ] Admin set wallet status: balance is not changed when status changes
- [ ] Admin lock group: requires `manage:groups` capability
- [ ] Notification draft: "Send broadcast" button is disabled and labeled as such
- [ ] Every privileged action writes an audit log entry within 5 s
- [ ] Audit log redaction: no message bodies, no full phones, no secrets

## M. Dashboard — Org scoping

- [ ] Sign in as `organization_admin` with `organizationId` claim
- [ ] Users list shows only users in that org
- [ ] Groups list shows only groups in that org
- [ ] Cross-org user search returns 0 hits
- [ ] Attempt to navigate to a user from another org by URL → not found / forbidden

## N. Security negative tests

- [ ] **Wallet:** sign in as test user; try to write `wallets/{me}` from a Firebase console mutation → denied
- [ ] **Payment:** try to write `payments/{me}/status = 'completed'` from console → denied
- [ ] **Audit:** try to add a doc to `auditLogs` from console → denied
- [ ] **Cross-user message read:** as user A, try to read a message in a conversation user A is not part of → denied
- [ ] **Cross-user receipt read:** as user A, try to read user B's receipt on a message A sent → allowed (sender exception); on a message A did not send → denied
- [ ] **SMS batch read:** as user A, try to read a batch with `senderId = userB` → denied
- [ ] **Privileged callable replay:** call `confirmPayment` from a non-server context → permission denied
- [ ] **Rate limit bypass attempt:** send 100 search requests in 10 s → 429 after request 60

## O. Performance spot checks

- [ ] Chats list loads ≤ 1 s on a typical account (≤ 100 conversations)
- [ ] Conversation opens ≤ 800 ms (50 visible messages)
- [ ] Admin overview loads ≤ 2 s
- [ ] Search returns first results within 500 ms
- [ ] Export CSV download starts within 3 s

## P. Regression

After every release, re-run sections A, B, F, J, K, L, N at minimum. Sections C, D, E should be re-run after any change touching chat fan-out, receipt aggregation, or SMS escalation.
